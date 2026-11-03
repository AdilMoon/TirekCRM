import {movementSource,receivedSql,expensesSql,cashFlowSql} from '../finance/ledger';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MovementQuery, MovementExportQuery, DocumentQuery } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { movementCsv, MAX_MOVEMENT_EXPORT_ROWS } from './movement-export';
type MovementRow={id:string;kind:'INCOME'|'EXPENSE'|'REFUND'|'EXPENSE_REVERSAL';sourceId:string|null;amount:Prisma.Decimal;description:string;category:string;orderId:string|null;orderNumber:number|null;createdAt:Date};
type DocumentRow={status:string;version:number;id:string;number:number;kind:string;orderId:string;orderNumber:number;clientName:string;total:string;createdAt:Date};
type Totals={total:bigint;received:Prisma.Decimal;expenses:Prisma.Decimal;cashFlow:Prisma.Decimal};
type MovementReportRow=Omit<MovementRow,'id'>&Totals&{id:string|null};
// UTC timestamps need explicit local boundaries. The upper bound is exclusive.
function dates(query:{from?:string;to?:string}) {
 return Prisma.sql`${query.from?Prisma.sql`AND "createdAt" >= ((${query.from}::date::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC')`:Prisma.empty}
 ${query.to?Prisma.sql`AND "createdAt" < (((${query.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC')`:Prisma.empty}`;
}
function numericQuery(q:string){const n=/^\d+$/.test(q)?Number(q):NaN;return Number.isSafeInteger(n)&&n<=2147483647?n:null;}
// One filter source for paginated JSON and CSV; all values stay SQL parameters.
function movementReportSource(org:string,query:MovementExportQuery){
  const number=numericQuery(query.q);
  return Prisma.sql`WITH movements AS (
${movementSource(org,query)}
  ), filtered AS (SELECT * FROM movements WHERE TRUE
   ${query.kind?Prisma.sql`AND kind=${query.kind}`:Prisma.empty}
   ${query.category?Prisma.sql`AND category=${query.category}`:Prisma.empty}
   ${query.orderId?Prisma.sql`AND "orderId"=${query.orderId}::uuid`:Prisma.empty}
   ${query.q?Prisma.sql`AND (strpos(lower(description),lower(${query.q}))>0 OR strpos(lower("orderTitle"),lower(${query.q}))>0 OR strpos(lower("clientName"),lower(${query.q}))>0 ${number===null?Prisma.empty:Prisma.sql`OR "orderNumber"=${number}`})`:Prisma.empty}
  )`;
}
@Injectable()
export class ReportsService {
 constructor(private readonly db:Database){}
 async movements(org:string,query:MovementQuery){
  const source=movementReportSource(org,query);
  // One statement shares one MVCC snapshot and evaluates the ledger once.
  // LEFT JOIN keeps totals available for an empty page, without a transaction lease.
  const rows=await this.db.client.$queryRaw<MovementReportRow[]>(Prisma.sql`${source},
   totals AS (SELECT count(*) AS total,${receivedSql} AS received,${expensesSql} AS expenses,${cashFlowSql} AS "cashFlow" FROM filtered),
   page_rows AS (SELECT id,kind,amount,description,category,"sourceId","orderId","orderNumber","createdAt" FROM filtered ORDER BY "createdAt" DESC,id DESC,kind DESC LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize})
   SELECT p.*,t.total,t.received,t.expenses,t."cashFlow" FROM totals t LEFT JOIN page_rows p ON TRUE
   ORDER BY p."createdAt" DESC,p.id DESC,p.kind DESC`);
  const summary=rows[0],total=Number(summary.total);
  const items=rows.filter((row):row is MovementReportRow&{id:string}=>row.id!==null)
   .map(({total:_total,received:_received,expenses:_expenses,cashFlow:_cashFlow,...row})=>({...row,amount:row.amount.toFixed(2)}));
  return {items,total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize),
   summary:{received:summary.received.toFixed(2),expenses:summary.expenses.toFixed(2),cashFlow:summary.cashFlow.toFixed(2)}};
 }
 async exportMovements(org:string,query:MovementExportQuery){
  // A single statement reads one MVCC snapshot. Totals come from these exact rows,
  // so a concurrent payment cannot appear only in the totals or only in the file.
  const rows=await this.db.client.$queryRaw<MovementRow[]>(Prisma.sql`${movementReportSource(org,query)}
   SELECT id,kind,amount,description,category,"sourceId","orderId","orderNumber","createdAt"
   FROM filtered ORDER BY "createdAt" DESC,id DESC,kind DESC LIMIT ${MAX_MOVEMENT_EXPORT_ROWS+1}`);
  if(rows.length>MAX_MOVEMENT_EXPORT_ROWS)throw new BadRequestException('Экспорт ограничен 10000 операциями. Сузьте период или фильтры');
  return movementCsv(rows);
 }
 async documents(org:string,query:DocumentQuery){
  const number=numericQuery(query.q);
  // Search immutable snapshot data, not the current client/order name.
  const source=Prisma.sql`WITH filtered AS (
   SELECT id,number,kind,status,version,"orderId",(snapshot->>'orderNumber')::integer AS "orderNumber",
    snapshot->'client'->>'name' AS "clientName",COALESCE(snapshot->'invoice'->>'amountDue',snapshot->>'total') AS total,"createdAt"
   FROM "Document" WHERE "organizationId"=${org}::uuid ${dates(query)}
   ${query.kind?Prisma.sql`AND kind=${query.kind}`:Prisma.empty}
   ${query.status?Prisma.sql`AND status=${query.status}`:Prisma.empty}
   ${query.orderId?Prisma.sql`AND "orderId"=${query.orderId}::uuid`:Prisma.empty}
   ${query.q?Prisma.sql`AND (strpos(lower(snapshot->'client'->>'name'),lower(${query.q}))>0 OR strpos(lower(snapshot->'client'->>'company'),lower(${query.q}))>0 OR strpos(lower(snapshot->>'title'),lower(${query.q}))>0 ${number===null?Prisma.empty:Prisma.sql`OR number=${number} OR (snapshot->>'orderNumber')::integer=${number}`})`:Prisma.empty}
  )`;
  const [items,counts]=await this.db.client.$transaction([
   this.db.client.$queryRaw<DocumentRow[]>(Prisma.sql`${source} SELECT * FROM filtered ORDER BY "createdAt" DESC,id DESC LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize}`),
   this.db.client.$queryRaw<{total:bigint}[]>(Prisma.sql`${source} SELECT count(*) AS total FROM filtered`),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  const total=Number(counts[0].total);
  return {items,total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize)};
 }
}
