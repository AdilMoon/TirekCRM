import {Prisma} from '@prisma/client';
// UTC timestamps need explicit local boundaries. The upper bound is exclusive.
function dates(query:{from?:string;to?:string}) {
 return Prisma.sql`${query.from?Prisma.sql`AND "createdAt" >= ((${query.from}::date::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC')`:Prisma.empty}
 ${query.to?Prisma.sql`AND "createdAt" < (((${query.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC')`:Prisma.empty}`;
}
export function movementSource(org:string,query:{from?:string;to?:string}={}){
 return Prisma.sql`
   SELECT p.id, 'INCOME'::text AS kind, p.amount,
    COALESCE(NULLIF(p.note,''),o.title) AS description, 'ORDER_PAYMENT'::text AS category,
    NULL::uuid AS "sourceId",p."orderId",o.number AS "orderNumber",p."createdAt",o.title AS "orderTitle",c.name AS "clientName"
   FROM (SELECT * FROM "Payment" WHERE "organizationId"=${org}::uuid ${dates(query)}) p
   JOIN "Order" o ON o.id=p."orderId" AND o."organizationId"=p."organizationId"
   JOIN "Client" c ON c.id=o."clientId" AND c."organizationId"=o."organizationId"
   UNION ALL
   SELECT e.id, 'EXPENSE'::text AS kind, e.amount,e.description,e.category,
    NULL::uuid AS "sourceId",e."orderId",o.number AS "orderNumber",e."createdAt",o.title AS "orderTitle",c.name AS "clientName"
   FROM (SELECT * FROM "Expense" WHERE "organizationId"=${org}::uuid ${dates(query)}) e
   LEFT JOIN "Order" o ON o.id=e."orderId" AND o."organizationId"=e."organizationId"
   LEFT JOIN "Client" c ON c.id=o."clientId" AND c."organizationId"=o."organizationId"
   UNION ALL
   SELECT r.id,'REFUND'::text,r.amount,r.reason,'ORDER_REFUND'::text,
    r."paymentId" AS "sourceId",p."orderId",o.number,r."createdAt",o.title,c.name
   FROM (SELECT * FROM "PaymentRefund" WHERE "organizationId"=${org}::uuid ${dates(query)}) r
   JOIN "Payment" p ON p.id=r."paymentId" AND p."organizationId"=r."organizationId"
   JOIN "Order" o ON o.id=p."orderId" AND o."organizationId"=p."organizationId"
   JOIN "Client" c ON c.id=o."clientId" AND c."organizationId"=o."organizationId"
   UNION ALL
   SELECT r.id,'EXPENSE_REVERSAL'::text,r.amount,r.reason,e.category,
    r."expenseId" AS "sourceId",e."orderId",o.number,r."createdAt",o.title,c.name
   FROM (SELECT * FROM "ExpenseReversal" WHERE "organizationId"=${org}::uuid ${dates(query)}) r
   JOIN "Expense" e ON e.id=r."expenseId" AND e."organizationId"=r."organizationId"
   LEFT JOIN "Order" o ON o.id=e."orderId" AND o."organizationId"=e."organizationId"
   LEFT JOIN "Client" c ON c.id=o."clientId" AND c."organizationId"=o."organizationId"
`;
}
export const receivedSql=Prisma.sql`COALESCE(sum(CASE WHEN kind='INCOME' THEN amount WHEN kind='REFUND' THEN -amount ELSE 0 END),0)`;
export const expensesSql=Prisma.sql`COALESCE(sum(CASE WHEN kind='EXPENSE' THEN amount WHEN kind='EXPENSE_REVERSAL' THEN -amount ELSE 0 END),0)`;
export const cashFlowSql=Prisma.sql`COALESCE(sum(CASE WHEN kind IN ('INCOME','EXPENSE_REVERSAL') THEN amount ELSE -amount END),0)`;
