import {Injectable,ConflictException,NotFoundException,ForbiddenException,BadRequestException} from '@nestjs/common';
import type {MessageOrderInput} from '@tirek/contracts';
import {Prisma} from '@prisma/client';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {digest} from '../../auth/session.guard';
import {totalForItems} from '../../common/money';
import {AuditService,type Actor} from '../audit/audit.service';
import {parseOrderMessage} from './message-parser';
@Injectable()
export class MessageOrdersService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 async preview(org:string,message:string){
  const result=parseOrderMessage(message);
  if(result.phone)result.matches=await this.db.client.$queryRaw<{id:string;name:string;phone:string}[]>(Prisma.sql`
   SELECT id,name,phone FROM "Client" WHERE "organizationId"=${org}::uuid
   AND regexp_replace(phone,'[^0-9]','','g') IN (${result.phone.slice(1)},${'8'+result.phone.slice(2)}) ORDER BY id LIMIT 5`);
  return result;
 }
 create(actor:Actor,input:MessageOrderInput){
  const total=totalForItems(input.order.items);
  if(BigInt(total.replace('.',''))>999999999999999999n)throw new BadRequestException('Сумма заказа слишком велика');
  const {idempotencyKey,...payload}=input,inputHash=digest(JSON.stringify(payload));
  return serializable(this.db.client,async tx=>{
   const active=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,role:'OWNER',isActive:true}});
   if(!active)throw new ForbiddenException('Недостаточно прав');
   const saved=await tx.messageOrderReceipt.findUnique({where:{organizationId_idempotencyKey:{organizationId:actor.organizationId,idempotencyKey}},include:{order:{select:{number:true}}}});
   if(saved){if(saved.inputHash!==inputHash||saved.actorId!==actor.id)throw new ConflictException('Ключ операции уже использован');return {orderId:saved.orderId,number:saved.order.number};}
   let clientId=input.clientId;
   if(clientId&&!await tx.client.findFirst({where:{id:clientId,organizationId:actor.organizationId}}))throw new NotFoundException('Клиент не найден');
   if(!clientId){
    const client=await tx.client.create({data:{...input.newClient!,organizationId:actor.organizationId}});clientId=client.id;
    await this.audit.record(tx,actor,'CLIENT',client.id,'CLIENT_CREATED',{name:client.name});
   }
   const org=await tx.organization.update({where:{id:actor.organizationId},data:{orderSeq:{increment:1}}});
   const order=await tx.order.create({data:{organizationId:actor.organizationId,clientId,number:org.orderSeq,title:input.order.title,notes:input.order.notes,
    dueDate:input.order.dueDate?new Date(input.order.dueDate+'T00:00:00Z'):null,total,
    items:{create:input.order.items.map(item=>({...item,total:totalForItems([item])}))}}});
   await this.audit.record(tx,actor,'ORDER',order.id,'ORDER_CREATED',{number:order.number,source:'MESSAGE',total:order.total.toFixed(2)});
   await tx.messageOrderReceipt.create({data:{organizationId:actor.organizationId,idempotencyKey,inputHash,actorId:actor.id,orderId:order.id}});
   return {orderId:order.id,number:order.number};
  });
 }
}
