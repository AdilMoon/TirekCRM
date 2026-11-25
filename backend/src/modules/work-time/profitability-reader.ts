import {Prisma} from '@prisma/client';
import type {OrderProfitability} from '@tirek/contracts';
import {calculateProfitability,select} from './profitability-calculation';
import {orderTimeTotalsSql,orderTimeActiveEntries,type OrderTimeTotals} from './order-time-totals';

export async function readProfitabilities(tx:Prisma.TransactionClient,organizationId:string,ids:string[]) {
  const result=new Map<string,OrderProfitability>();
  if(!ids.length)return result;
  const orders=await tx.order.findMany({where:{organizationId,OR:[{id:{in:ids}},{repeatOfId:{in:ids}}]},
    select:{...select,notes:true,createdAt:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  if(!orders.length)return result;
  const orderIds=orders.map(order=>order.id);
  const sqlIds=Prisma.join(orderIds.map(id=>Prisma.sql`${id}::uuid`));
  const times=await tx.$queryRaw<(OrderTimeTotals & {orderId:string;employeeId:string;name:string})[]>(Prisma.sql`
    SELECT a."orderId",u.id AS "employeeId",u.name,${orderTimeTotalsSql}
    FROM "WorkTimeAllocation" a
    JOIN "WorkTimeEntry" e ON e.id=a."entryId" AND e."organizationId"=a."organizationId"
    JOIN "User" u ON u.id=e."employeeId" AND u."organizationId"=e."organizationId"
    WHERE a."organizationId"=${organizationId}::uuid AND a."orderId" IN (${sqlIds}) AND ${orderTimeActiveEntries}
    GROUP BY a."orderId",u.id,u.name ORDER BY a."orderId","actualMinutes" DESC,u.name,u.id`);
  const expenses=await tx.$queryRaw<{orderId:string;cents:string}[]>(Prisma.sql`
    SELECT e."orderId",SUM(((e.amount-COALESCE(r.amount,0))*100)::bigint)::text AS cents
    FROM "Expense" e LEFT JOIN "ExpenseReversal" r ON r."expenseId"=e.id AND r."organizationId"=e."organizationId"
    WHERE e."organizationId"=${organizationId}::uuid AND e."orderId" IN (${sqlIds}) GROUP BY e."orderId"`);
  const materials=await tx.materialMovement.groupBy({by:['orderId'],where:{organizationId,orderId:{in:orderIds}},_sum:{costCents:true}});
  const rates=await tx.orderLaborRate.findMany({where:{organizationId,orderId:{in:orderIds}},select:{orderId:true,employeeId:true,hourlyRate:true}});
  const timeByOrder=new Map<string,typeof times>();
  for(const time of times){const list=timeByOrder.get(time.orderId)??[];list.push(time);timeByOrder.set(time.orderId,list);}
  const ratesByOrder=new Map<string,typeof rates>();
  for(const rate of rates){const list=ratesByOrder.get(rate.orderId)??[];list.push(rate);ratesByOrder.set(rate.orderId,list);}
  const children=new Map<string,typeof orders>();
  for(const order of orders)if(order.repeatOfId){
    const list=children.get(order.repeatOfId)??[];list.push(order);children.set(order.repeatOfId,list);
  }
  const expenseByOrder=new Map(expenses.map(row=>[row.orderId,BigInt(row.cents)]));
  const materialByOrder=new Map(materials.map(row=>[row.orderId,row._sum.costCents??0n]));
  const compute=(order:typeof orders[number]):OrderProfitability=>{
    const cached=result.get(order.id);
    if(cached)return cached;
    const visits=order.repeatOfId?[]:children.get(order.id)??[];
    const calculated=calculateProfitability(order,timeByOrder.get(order.id)??[],ratesByOrder.get(order.id)??[],
      expenseByOrder.get(order.id)??0n,materialByOrder.get(order.id)??0n,
      visits.map(visit=>({result:compute(visit),reason:visit.notes})));
    result.set(order.id,calculated);
    return calculated;
  };
  for(const order of orders)compute(order);
  return result;
}
