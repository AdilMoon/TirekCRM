import {ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {RefundInput,ExpenseReversalInput,ExpenseReplacementInput} from '@tirek/contracts';
import {randomUUID} from 'node:crypto';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {cents,money} from '../../common/money';
import {AuditService,Actor} from '../audit/audit.service';
const correction=(row:{id:string;amount:Prisma.Decimal;reason:string;actorName:string;createdAt:Date})=>({id:row.id,amount:row.amount.toFixed(2),reason:row.reason,actorName:row.actorName,createdAt:row.createdAt});
function replacementResult(row:Prisma.ExpenseReversalGetPayload<{include:{replacementExpense:true}}>){
 const expense=row.replacementExpense;
 if(!expense)throw new ConflictException('Ключ уже использован для другой финансовой операции');
 return {originalExpenseId:row.expenseId,reversal:correction(row),expense:{id:expense.id,amount:expense.amount.toFixed(2),description:expense.description,category:expense.category,orderId:expense.orderId,createdAt:expense.createdAt}};
}
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
  const row=await this.db.client.expense.findFirst({where:{id,organizationId:org},include:{reversal:true,replaces:true}});
  if(!row)throw new NotFoundException('Расход не найден');
  return {id:row.id,kind:'EXPENSE',amount:row.amount.toFixed(2),remaining:row.reversal?'0.00':row.amount.toFixed(2),description:row.description,category:row.category,orderId:row.orderId,createdAt:row.createdAt,corrections:row.reversal?[correction(row.reversal)]:[],replacementExpenseId:row.reversal?.replacementExpenseId??null,replacesExpenseId:row.replaces?.expenseId??null};
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
    if(existing.replacementExpenseId||existing.expenseId!==id||existing.actorId!==owner.id||existing.reason!==input.reason)throw new ConflictException('Ключ уже использован для другой финансовой операции');
    return correction(existing);
   }
   if(row.reversal)throw new ConflictException('Расход уже сторнирован');
   const lot=await tx.materialLot.findFirst({where:{expenseId:id,organizationId},select:{available:true,quantity:true}});
   if(lot && lot.available!==lot.quantity)throw new ConflictException('Сначала верните выданные материалы из заказов');
   const reversed=await tx.expenseReversal.create({data:{organizationId,expenseId:id,amount:row.amount,reason:input.reason,idempotencyKey:input.idempotencyKey,actorId:owner.id,actorName:owner.name}});
   await this.audit.record(tx,owner,'EXPENSE',id,'EXPENSE_REVERSED',{reversalId:reversed.id,amount:row.amount.toFixed(2),category:row.category});
   return correction(reversed);
  });
 }
 async replace(actor:Actor,id:string,input:ExpenseReplacementInput){
  return serializable(this.db.client,async tx=>{
   const owner=await this.owner(tx,actor),organizationId=owner.organizationId;
   const row=await tx.expense.findFirst({where:{id,organizationId},include:{reversal:true}});
   if(!row)throw new NotFoundException('Расход не найден');
   // Reversal and replacement share a key namespace. Cross-endpoint retries must
   // conflict rather than reinterpret a completed two-record correction.
   const existing=await tx.expenseReversal.findUnique({where:{organizationId_idempotencyKey:{organizationId,idempotencyKey:input.idempotencyKey}},include:{replacementExpense:true}});
   const amount=money(cents(input.amount));
   if(existing){
    const expense=existing.replacementExpense;
    if(!expense||existing.expenseId!==id||existing.actorId!==owner.id||existing.reason!==input.reason||expense.amount.toFixed(2)!==amount||expense.description!==input.description||expense.category!==input.category||expense.orderId!==input.orderId)throw new ConflictException('Ключ уже использован для другой финансовой операции');
    return replacementResult(existing);
   }
   if(row.reversal)throw new ConflictException('Расход уже сторнирован');
   if(await tx.materialLot.findFirst({where:{expenseId:id,organizationId},select:{expenseId:true}}))throw new ConflictException('Для отмены закупки используйте сторно');
   if(row.amount.toFixed(2)===amount&&row.description===input.description&&row.category===input.category&&row.orderId===input.orderId)throw new ConflictException('Новый расход должен отличаться от исходного');
   if(input.orderId&&!await tx.order.findFirst({where:{id:input.orderId,organizationId}}))throw new NotFoundException('Заказ не найден');
   const createdAt=new Date();
   const expense=await tx.expense.create({data:{organizationId,amount,description:input.description,category:input.category,orderId:input.orderId,idempotencyKey:randomUUID(),createdAt}});
   const reversed=await tx.expenseReversal.create({data:{organizationId,expenseId:id,replacementExpenseId:expense.id,amount:row.amount,reason:input.reason,idempotencyKey:input.idempotencyKey,actorId:owner.id,actorName:owner.name,createdAt},include:{replacementExpense:true}});
   await this.audit.record(tx,owner,'EXPENSE',id,'EXPENSE_REVERSED',{reversalId:reversed.id,amount:row.amount.toFixed(2),category:row.category,replacementExpenseId:expense.id});
   await this.audit.record(tx,owner,'EXPENSE',expense.id,'EXPENSE_RECORDED',{amount:expense.amount.toFixed(2),category:expense.category,replacesExpenseId:id});
   return replacementResult(reversed);
  });
 }
}
