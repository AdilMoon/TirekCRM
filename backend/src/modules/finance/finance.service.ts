import {ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {RefundInput,ExpenseReversalInput} from '@tirek/contracts';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {cents,money} from '../../common/money';
import {AuditService,Actor} from '../audit/audit.service';
const correction=(row:{id:string;amount:Prisma.Decimal;reason:string;actorName:string;createdAt:Date})=>({id:row.id,amount:row.amount.toFixed(2),reason:row.reason,actorName:row.actorName,createdAt:row.createdAt});
@Injectable()
export class FinanceService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 private async owner(tx:Prisma.TransactionClient,actor:Actor){
  const user=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,role:'OWNER',isActive:true}});
  if(!user)throw new ForbiddenException('Недостаточно прав');
  return {id:user.id,organizationId:user.organizationId,name:user.name};
 }
 async payment(org:string,id:string){
  const row=await this.db.client.payment.findFirst({where:{id,organizationId:org},include:{order:true,refunds:{orderBy:[{createdAt:'desc'},{id:'desc'}]}}});
  if(!row)throw new NotFoundException('Оплата не найдена');
  return {id:row.id,kind:'INCOME',amount:row.amount.toFixed(2),remaining:money(cents(row.amount.toFixed(2))-row.refunds.reduce((s,r)=>s+cents(r.amount.toFixed(2)),0n)),description:row.note||row.order.title,createdAt:row.createdAt,corrections:row.refunds.map(correction)};
 }
 async expense(org:string,id:string){
  const row=await this.db.client.expense.findFirst({where:{id,organizationId:org},include:{reversal:true}});
  if(!row)throw new NotFoundException('Расход не найден');
  return {id:row.id,kind:'EXPENSE',amount:row.amount.toFixed(2),remaining:row.reversal?'0.00':row.amount.toFixed(2),description:row.description,createdAt:row.createdAt,corrections:row.reversal?[correction(row.reversal)]:[]};
 }
 async refund(actor:Actor,id:string,input:RefundInput){
  return serializable(this.db.client,async tx=>{
   const owner=await this.owner(tx,actor),organizationId=owner.organizationId;
   const row=await tx.payment.findFirst({where:{id,organizationId},include:{refunds:true,order:true}});
   if(!row)throw new NotFoundException('Оплата не найдена');
   const existing=await tx.paymentRefund.findUnique({where:{organizationId_idempotencyKey:{organizationId,idempotencyKey:input.idempotencyKey}}});
   if(existing){
    if(existing.paymentId!==id||existing.actorId!==owner.id||existing.reason!==input.reason||existing.amount.toFixed(2)!==money(cents(input.amount)))throw new ConflictException('Ключ уже использован для другой финансовой операции');
    return correction(existing);
   }
   const remaining=cents(row.amount.toFixed(2))-row.refunds.reduce((s,r)=>s+cents(r.amount.toFixed(2)),0n);
   if(cents(input.amount)>remaining)throw new ConflictException('Возврат превышает доступный остаток оплаты');
   const refund=await tx.paymentRefund.create({data:{organizationId,paymentId:id,amount:input.amount,reason:input.reason,idempotencyKey:input.idempotencyKey,actorId:owner.id,actorName:owner.name}});
   // Shared order write serializes refunds against payments, edits, cancellations and invoice snapshots.
   await tx.order.update({where:{id:row.orderId},data:{version:{increment:1}}});
   await this.audit.record(tx,owner,'ORDER',row.orderId,'PAYMENT_REFUNDED',{number:row.order.number,paymentId:id,refundId:refund.id,amount:refund.amount.toFixed(2)});
   return correction(refund);
  });
 }
 async reverse(actor:Actor,id:string,input:ExpenseReversalInput){
  return serializable(this.db.client,async tx=>{
   const owner=await this.owner(tx,actor),organizationId=owner.organizationId;
   const row=await tx.expense.findFirst({where:{id,organizationId},include:{reversal:true}});
   if(!row)throw new NotFoundException('Расход не найден');
   const existing=await tx.expenseReversal.findUnique({where:{organizationId_idempotencyKey:{organizationId,idempotencyKey:input.idempotencyKey}}});
   if(existing){
    if(existing.expenseId!==id||existing.actorId!==owner.id||existing.reason!==input.reason)throw new ConflictException('Ключ уже использован для другой финансовой операции');
    return correction(existing);
   }
   if(row.reversal)throw new ConflictException('Расход уже сторнирован');
   const reversed=await tx.expenseReversal.create({data:{organizationId,expenseId:id,amount:row.amount,reason:input.reason,idempotencyKey:input.idempotencyKey,actorId:owner.id,actorName:owner.name}});
   await this.audit.record(tx,owner,'EXPENSE',id,'EXPENSE_REVERSED',{reversalId:reversed.id,amount:row.amount.toFixed(2),category:row.category});
   return correction(reversed);
  });
 }
}
