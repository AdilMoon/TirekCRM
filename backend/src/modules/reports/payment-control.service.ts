import {Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {PaymentControlPage,PaymentControlQuery,PaymentControlRow} from '@tirek/contracts';
import {Database} from '../../database/database.service';

type Row=Omit<PaymentControlRow,'total'|'paid'|'balance'>&{total:Prisma.Decimal;paid:Prisma.Decimal;balance:Prisma.Decimal;
 count:bigint;today:string;allBalance:Prisma.Decimal;overdue:Prisma.Decimal;scheduled:Prisma.Decimal;noDue:Prisma.Decimal};
@Injectable()
export class PaymentControlService {
 constructor(private readonly db:Database){}
 async list(org:string,query:PaymentControlQuery):Promise<PaymentControlPage>{
  const n=/^\d+$/.test(query.q)?Number(query.q):NaN;
  const number=Number.isSafeInteger(n)&&n<=2147483647?n:null;
  // One statement: balances, deadlines, filters and totals share an MVCC snapshot.
  // Aggregate refunds before payments: joining raw children would multiply money.
  const rows=await this.db.client.$queryRaw<Row[]>(Prisma.sql`WITH
   clock AS (SELECT to_char(now() AT TIME ZONE 'Asia/Almaty','YYYY-MM-DD') AS today),
   refunds AS (SELECT "paymentId",sum(amount) AS amount FROM "PaymentRefund" WHERE "organizationId"=${org}::uuid GROUP BY "paymentId"),
   paid AS (SELECT p."orderId",sum(p.amount-coalesce(r.amount,0)) AS amount FROM "Payment" p
    LEFT JOIN refunds r ON r."paymentId"=p.id WHERE p."organizationId"=${org}::uuid GROUP BY p."orderId"),
   latest AS (SELECT DISTINCT ON ("orderId") "orderId",id,number,status,snapshot FROM "Document"
    WHERE "organizationId"=${org}::uuid AND kind='INVOICE_DRAFT' ORDER BY "orderId","createdAt" DESC,number DESC,id DESC),
   balances AS (SELECT o.id,o.number,o.title,c.name AS "clientName",o.total,coalesce(p.amount,0) AS paid,
    o.total-coalesce(p.amount,0) AS balance,
    CASE WHEN d.status='DRAFT' THEN d.snapshot->'invoice'->>'dueDate' END AS "dueDate",
    CASE WHEN d.status='DRAFT' THEN d.id END AS "invoiceId",CASE WHEN d.status='DRAFT' THEN d.number END AS "invoiceNumber"
    FROM "Order" o JOIN "Client" c ON c.id=o."clientId" AND c."organizationId"=o."organizationId"
    LEFT JOIN paid p ON p."orderId"=o.id LEFT JOIN latest d ON d."orderId"=o.id
    WHERE o."organizationId"=${org}::uuid AND o.status!='CANCELLED'
    ${query.q?Prisma.sql`AND (strpos(lower(o.title),lower(${query.q}))>0 OR strpos(lower(c.name),lower(${query.q}))>0
     OR strpos(lower(c.company),lower(${query.q}))>0 ${number===null?Prisma.empty:Prisma.sql`OR o.number=${number}`})`:Prisma.empty}),
   outstanding AS (SELECT b.*,CASE WHEN "dueDate" IS NULL THEN 'NO_DUE' WHEN "dueDate"<clock.today THEN 'OVERDUE' ELSE 'SCHEDULED' END AS state
    FROM balances b CROSS JOIN clock WHERE balance>0),
   filtered AS (SELECT * FROM outstanding ${query.state?Prisma.sql`WHERE state=${query.state}`:Prisma.empty}),
   totals AS (SELECT count(*) AS count,coalesce(sum(balance),0) AS "allBalance",
    coalesce(sum(balance) FILTER (WHERE state='OVERDUE'),0) AS overdue,
    coalesce(sum(balance) FILTER (WHERE state='SCHEDULED'),0) AS scheduled,
    coalesce(sum(balance) FILTER (WHERE state='NO_DUE'),0) AS "noDue" FROM filtered),
   page AS (SELECT * FROM filtered ORDER BY CASE state WHEN 'OVERDUE' THEN 0 WHEN 'SCHEDULED' THEN 1 ELSE 2 END,
    "dueDate" ASC NULLS LAST,number,id LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize})
   SELECT p.*,t.*,clock.today FROM totals t CROSS JOIN clock LEFT JOIN page p ON TRUE
   ORDER BY CASE p.state WHEN 'OVERDUE' THEN 0 WHEN 'SCHEDULED' THEN 1 ELSE 2 END,p."dueDate" ASC NULLS LAST,p.number,p.id`);
  const head=rows[0],total=Number(head.count);
  return {items:rows.filter(r=>r.id!==null).map(r=>({id:r.id,number:r.number,title:r.title,clientName:r.clientName,
   total:r.total.toFixed(2),paid:r.paid.toFixed(2),balance:r.balance.toFixed(2),dueDate:r.dueDate,
   invoiceId:r.invoiceId,invoiceNumber:r.invoiceNumber,state:r.state})),total,page:query.page,pageSize:query.pageSize,
   pages:Math.ceil(total/query.pageSize),today:head.today,
   summary:{balance:head.allBalance.toFixed(2),overdue:head.overdue.toFixed(2),scheduled:head.scheduled.toFixed(2),noDue:head.noDue.toFixed(2)}};
 }
}
