import {ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {DocumentSnapshot,InvoiceInput} from '@tirek/contracts';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {cents,money} from '../../common/money';
import {AuditService,Actor} from '../audit/audit.service';
import {orderInclude} from '../crm/crm.service';
import {clientRequisites,organizationRequisites} from './snapshot';

@Injectable()
export class InvoicesService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 async create(org:string,orderId:string,input:InvoiceInput,actor:Actor){
  return serializable(this.db.client,async tx=>{
   const previous=await tx.document.findUnique({where:{organizationId_idempotencyKey:{organizationId:org,idempotencyKey:input.idempotencyKey}}});
   if(previous){
    const invoice=(previous.snapshot as unknown as DocumentSnapshot).invoice;
    if(previous.orderId!==orderId||previous.kind!=='INVOICE_DRAFT'||!invoice||invoice.orderVersion!==input.orderVersion||invoice.dueDate!==input.dueDate||invoice.note!==input.note)
     throw new ConflictException('Этот ключ уже использован для другого счёта');
    return previous;
   }
   const order=await tx.order.findFirst({where:{id:orderId,organizationId:org},include:orderInclude});
   if(!order)throw new NotFoundException('Заказ не найден');
   if(order.version!==input.orderVersion)throw new ConflictException('Заказ уже изменён. Откройте его заново');
   if(order.status==='CANCELLED')throw new ConflictException('Нельзя создать счёт для отменённого заказа');
   const paid=order.payments.reduce((sum,p)=>sum+cents(p.amount.toFixed(2)),0n);
   const amountDue=cents(order.total.toFixed(2))-paid;
   if(amountDue<=0n)throw new ConflictException('Заказ уже полностью оплачен');
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   if(input.dueDate&&input.dueDate<today)throw new ConflictException('Срок оплаты не может быть в прошлом');
   const organization=await tx.organization.findUniqueOrThrow({where:{id:org}});
   if(!organization.businessId||!organization.address||!organization.bankName||!organization.iban||!organization.bic)
    throw new ConflictException('Заполните ИИН/БИН, адрес и банковские реквизиты предприятия в настройках');
   const numbered=await tx.organization.update({where:{id:org},data:{documentSeq:{increment:1}}});
   const snapshot:DocumentSnapshot={
    organization:organizationRequisites(organization),client:clientRequisites(order.client),
    orderNumber:order.number,title:order.title,total:order.total.toFixed(2),
    items:order.items.map(item=>({description:item.description,quantity:item.quantity,unitPrice:item.unitPrice.toFixed(2),total:item.total.toFixed(2)})),
    invoice:{orderVersion:input.orderVersion,dueDate:input.dueDate,note:input.note,paid:money(paid),amountDue:money(amountDue),currency:'KZT'},
   };
   const document=await tx.document.create({data:{organizationId:org,orderId,number:numbered.documentSeq,kind:'INVOICE_DRAFT',idempotencyKey:input.idempotencyKey,snapshot:snapshot as unknown as Prisma.InputJsonValue}});
   await this.audit.record(tx,actor,'ORDER',orderId,'INVOICE_CREATED',{number:order.number,documentNumber:document.number,documentId:document.id,amountDue:money(amountDue)});
   return document;
  });
 }
}
