import {Prisma} from '@prisma/client';
import {cents} from './money';
export const paymentsWithRefunds={payments:{include:{refunds:true}}} satisfies Prisma.OrderInclude;
export function paidCents(payments:{amount:Prisma.Decimal;refunds:{amount:Prisma.Decimal}[]}[]){
 return payments.reduce((sum,p)=>sum+cents(p.amount.toFixed(2))-p.refunds.reduce((s,r)=>s+cents(r.amount.toFixed(2)),0n),0n);
}
