import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MovementQuery, DocumentQuery } from '@tirek/contracts';
import { Database } from '../../database/database.service';
type MovementRow={id:string;kind:'INCOME'|'EXPENSE';amount:Prisma.Decimal;description:string;category:string;orderId:string|null;orderNumber:number|null;createdAt:Date};
type DocumentRow={id:string;number:number;kind:string;orderId:string;orderNumber:number;clientName:string;total:string;createdAt:Date};
type Totals={total:bigint;received:Prisma.Decimal;expenses:Prisma.Decimal;cashFlow:Prisma.Decimal};
// UTC timestamps need explicit local boundaries. The upper bound is exclusive.
function dates(query:{from?:string;to?:string}) {
 return Prisma.sql`${query.from?Prisma.sql`AND "createdAt" >= ((${query.from}::date::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC')`:Prisma.empty}
 ${query.to?Prisma.sql`AND "createdAt" < (((${query.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC')`:Prisma.empty}`;
}
function numericQuery(q:string){const n=/^\d+$/.test(q)?Number(q):NaN;return Number.isSafeInteger(n)&&n<=2147483647?n:null;}
@Injectable()
export class ReportsService {
 constructor(private readonly db:Database){}
 async movements(org:string,query:MovementQuery){
  const number=numericQuery(query.q);
  const source=Prisma.sql`WITH movements AS (
   SELECT p.id, 'INCOME'::text AS kind, p.amount,
    COALESCE(NULLIF(p.note,''),o.title) AS description, 'ORDER_PAYMENT'::text AS category,
    p."orderId",o.number AS "orderNumber",p."createdAt",o.title AS "orderTitle",c.name AS "clientName"
   FROM (SELECT * FROM "Payment" WHERE "organizationId"=${org}::uuid ${dates(query)}) p
   JOIN "Order" o ON o.id=p."orderId" AND o."organizationId"=p."organizationId"
   JOIN "Client" c ON c.id=o."clientId" AND c."organizationId"=o."organizationId"
   UNION ALL
   SELECT e.id, 'EXPENSE'::text AS kind, e.amount,e.description,e.category,
    e."orderId",o.number AS "orderNumber",e."createdAt",o.title AS "orderTitle",c.name AS "clientName"
   FROM (SELECT * FROM "Expense" WHERE "organizationId"=${org}::uuid ${dates(query)}) e
   LEFT JOIN "Order" o ON o.id=e."orderId" AND o."organizationId"=e."organizationId"
   LEFT JOIN "Client" c ON c.id=o."clientId" AND c."organizationId"=o."organizationId"
  ), filtered AS (SELECT * FROM movements WHERE TRUE
   ${query.kind?Prisma.sql`AND kind=${query.kind}`:Prisma.empty}
   ${query.category?Prisma.sql`AND category=${query.category}`:Prisma.empty}
   ${query.orderId?Prisma.sql`AND "orderId"=${query.orderId}::uuid`:Prisma.empty}
   ${query.q?Prisma.sql`AND (strpos(lower(description),lower(${query.q}))>0 OR strpos(lower("orderTitle"),lower(${query.q}))>0 OR strpos(lower("clientName"),lower(${query.q}))>0 ${number===null?Prisma.empty:Prisma.sql`OR "orderNumber"=${number}`})`:Prisma.empty}
  )`;
  const [rows,totals]=await this.db.client.$transaction([
   this.db.client.$queryRaw<MovementRow[]>(Prisma.sql`${source} SELECT id,kind,amount,description,category,"orderId","orderNumber","createdAt" FROM filtered ORDER BY "createdAt" DESC,id DESC,kind DESC LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize}`),
   this.db.client.$queryRaw<Totals[]>(Prisma.sql`${source} SELECT count(*) AS total,COALESCE(sum(amount) FILTER (WHERE kind='INCOME'),0) AS received,COALESCE(sum(amount) FILTER (WHERE kind='EXPENSE'),0) AS expenses,COALESCE(sum(CASE WHEN kind='INCOME' THEN amount ELSE -amount END),0) AS "cashFlow" FROM filtered`),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  const summary=totals[0],total=Number(summary.total);
  return {items:rows.map(row=>({...row,amount:row.amount.toFixed(2)})),total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize),
   summary:{received:summary.received.toFixed(2),expenses:summary.expenses.toFixed(2),cashFlow:summary.cashFlow.toFixed(2)}};
 }
 async documents(org:string,query:DocumentQuery){
  const number=numericQuery(query.q);
  // Search immutable snapshot data, not the current client/order name.
  const source=Prisma.sql`WITH filtered AS (
   SELECT id,number,kind,"orderId",(snapshot->>'orderNumber')::integer AS "orderNumber",
    snapshot->'client'->>'name' AS "clientName",COALESCE(snapshot->'invoice'->>'amountDue',snapshot->>'total') AS total,"createdAt"
   FROM "Document" WHERE "organizationId"=${org}::uuid ${dates(query)}
   ${query.kind?Prisma.sql`AND kind=${query.kind}`:Prisma.empty}
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
