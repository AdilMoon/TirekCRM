import {Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {ClientOverviewQuery,ClientOverviewPage,ClientOrderRow} from '@tirek/contracts';
import {Database} from '../../database/database.service';
type Row=Omit<ClientOrderRow,'id'|'total'|'paid'|'balance'|'createdAt'|'dueDate'>&{id:string|null;createdAt:Date;dueDate:Date|null;
 total:Prisma.Decimal;paid:Prisma.Decimal;balance:Prisma.Decimal;filtered:bigint;orders:bigint;active:bigint;completed:bigint;
 orderTotal:Prisma.Decimal;netPaid:Prisma.Decimal;outstanding:Prisma.Decimal};
@Injectable()
export class ClientOverviewService {
 constructor(private readonly db:Database){}
 async overview(org:string,id:string,query:ClientOverviewQuery):Promise<ClientOverviewPage>{
  return this.db.client.$transaction(async tx=>{
   const client=await tx.client.findFirst({where:{id,organizationId:org},select:{id:true,version:true,name:true,company:true,
    phone:true,email:true,address:true,businessId:true,bankName:true,iban:true,bic:true,createdAt:true}});
   if(!client)throw new NotFoundException('Клиент не найден');
   const n=/^\d+$/.test(query.q)?Number(query.q):NaN,number=Number.isSafeInteger(n)&&n<=2147483647?n:null;
   // A fixed number of batch reads; no per-order payment/refund lookups.
   const rows=await tx.$queryRaw<Row[]>(Prisma.sql`WITH
    orders AS (SELECT id,number,title,status,total,"createdAt","dueDate" FROM "Order"
     WHERE "organizationId"=${org}::uuid AND "clientId"=${id}::uuid),
    refunds AS (SELECT r."paymentId",sum(r.amount) AS amount FROM "PaymentRefund" r
     JOIN "Payment" p ON p.id=r."paymentId" AND p."organizationId"=r."organizationId" JOIN orders o ON o.id=p."orderId"
     WHERE r."organizationId"=${org}::uuid GROUP BY r."paymentId"),
    paid AS (SELECT p."orderId",sum(p.amount-coalesce(r.amount,0)) AS amount FROM "Payment" p
     JOIN orders o ON o.id=p."orderId" LEFT JOIN refunds r ON r."paymentId"=p.id
     WHERE p."organizationId"=${org}::uuid GROUP BY p."orderId"),
    balances AS (SELECT o.*,coalesce(p.amount,0) AS paid,
     CASE WHEN o.status='CANCELLED' THEN 0 ELSE greatest(o.total-coalesce(p.amount,0),0) END AS balance
     FROM orders o LEFT JOIN paid p ON p."orderId"=o.id),
    summary AS (SELECT count(*) AS orders,count(*) FILTER (WHERE status IN ('NEW','CONFIRMED','IN_PROGRESS')) AS active,
     count(*) FILTER (WHERE status='COMPLETED') AS completed,
     coalesce(sum(total) FILTER (WHERE status!='CANCELLED'),0) AS "orderTotal",
     coalesce(sum(paid) FILTER (WHERE status!='CANCELLED'),0) AS "netPaid",coalesce(sum(balance),0) AS outstanding FROM balances),
    filtered AS (SELECT * FROM balances WHERE TRUE
     ${query.status?Prisma.sql`AND status::text=${query.status}`:Prisma.empty}
     ${query.unpaid?Prisma.sql`AND balance>0`:Prisma.empty}
     ${query.q?Prisma.sql`AND (strpos(lower(title),lower(${query.q}))>0 ${number===null?Prisma.empty:Prisma.sql`OR number=${number}`})`:Prisma.empty}),
    counts AS (SELECT count(*) AS filtered FROM filtered),
    page AS (SELECT * FROM filtered ORDER BY "createdAt" DESC,id DESC LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize})
    SELECT p.*,s.*,c.filtered FROM summary s CROSS JOIN counts c LEFT JOIN page p ON TRUE ORDER BY p."createdAt" DESC,p.id DESC`);
   const head=rows[0],total=Number(head.filtered);
   return {client:{...client,createdAt:client.createdAt.toISOString(),ordersCount:Number(head.orders)},
    items:rows.filter(row=>row.id!==null).map(row=>({id:row.id!,number:row.number,title:row.title,status:row.status,
     createdAt:row.createdAt.toISOString(),dueDate:row.dueDate?.toISOString()??null,total:row.total.toFixed(2),paid:row.paid.toFixed(2),balance:row.balance.toFixed(2)})),
    total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize),
    summary:{orders:Number(head.orders),active:Number(head.active),completed:Number(head.completed),total:head.orderTotal.toFixed(2),
     paid:head.netPaid.toFixed(2),outstanding:head.outstanding.toFixed(2)}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:20000});
 }
}
