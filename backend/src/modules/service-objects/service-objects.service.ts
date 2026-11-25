import {ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {ObjectBindInput,ServiceDecisionInput,ServiceRequestInput} from '@tirek/contracts';
import type {AuthRequest} from '../../auth/session.guard';
import {digest} from '../../auth/session.guard';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {cents,money} from '../../common/money';
import {AuditService} from '../audit/audit.service';
type Actor=AuthRequest['user'];
const objectSelect={id:true,name:true,address:true} as const;
const pageOf=<T>(items:T[],total:number,page:number)=>({items,total,page,pageSize:10,pages:Math.ceil(total/10)});
@Injectable()
export class ServiceObjectsService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 private async access(tx:Prisma.TransactionClient,actor:Actor,id:string,ownerOnly=false){
  const user=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true}});
  if(!user||(ownerOnly&&user.role!=='OWNER'))throw new ForbiddenException('Недостаточно прав');
  const order=await tx.order.findFirst({where:{id,organizationId:actor.organizationId}});
  if(!order)throw new NotFoundException('Заказ не найден');
  if(user.role!=='OWNER'&&!await tx.businessTask.findFirst({where:{organizationId:actor.organizationId,orderId:id,assigneeId:actor.id,status:{in:['TODO','IN_PROGRESS']}}}))
   throw new NotFoundException('Заказ не найден');
  return {order,owner:user.role==='OWNER'};
 }
 context(actor:Actor,id:string,query:{historyPage:number;requestPage:number}){
  return this.db.client.$transaction(async tx=>{
   const {order,owner}=await this.access(tx,actor,id);
   const object=order.serviceObjectId?await tx.serviceObject.findFirstOrThrow({where:{id:order.serviceObjectId,organizationId:actor.organizationId},select:objectSelect}):null;
   const where:Prisma.OrderWhereInput={organizationId:actor.organizationId,serviceObjectId:object?.id??'00000000-0000-0000-0000-000000000000',...(!owner?{status:'COMPLETED'}:{})};
   const history=object?await tx.order.findMany({where,select:{id:true,number:true,title:true,status:true,dueDate:true,createdAt:true,repeatOfId:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:10,skip:(query.historyPage-1)*10}):[];
   const total=object?await tx.order.count({where}):0;
   let requests;
   if(owner){
    const scope={organizationId:actor.organizationId,objectId:object?.id??'00000000-0000-0000-0000-000000000000'};
    const rows=object?await tx.serviceRequest.findMany({where:scope,select:{id:true,description:true,status:true,version:true,createdAt:true,sourceOrderId:true,convertedOrderId:true,decisionNote:true,sourceOrder:{select:{number:true}},convertedOrder:{select:{number:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:10,skip:(query.requestPage-1)*10}):[];
    requests=pageOf(rows.map(({sourceOrder,convertedOrder,...row})=>({...row,sourceNumber:sourceOrder.number,convertedNumber:convertedOrder?.number??null})),object?await tx.serviceRequest.count({where:scope}):0,query.requestPage);
   }
   return {object,canManage:owner,orderVersion:order.version,history:pageOf(history,total,query.historyPage),...(owner?{requests}: {})};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 choices(actor:Actor,id:string,query:{q:string;page:number}){
  return this.db.client.$transaction(async tx=>{
   const {order}=await this.access(tx,actor,id,true);
   const where={organizationId:actor.organizationId,clientId:order.clientId,...(query.q?{OR:[{name:{contains:query.q,mode:'insensitive' as const}},{address:{contains:query.q,mode:'insensitive' as const}}]}:{})};
   const items=await tx.serviceObject.findMany({where,select:objectSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],take:10,skip:(query.page-1)*10});
   return pageOf(items,await tx.serviceObject.count({where}),query.page);
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 bind(actor:Actor,id:string,input:ObjectBindInput){
  const inputHash=digest(JSON.stringify({actorId:actor.id,id,input}));
  return serializable(this.db.client,async tx=>{
   const {order}=await this.access(tx,actor,id,true);
   if(order.repeatOfId)throw new ConflictException('Объект повторного выезда задаётся в исходном заказе');
   const old=input.kind==='CREATE'?await tx.serviceObject.findUnique({where:{organizationId_creationKey:{organizationId:actor.organizationId,creationKey:input.creationKey}}}):null;
   if(old){
    if(old.inputHash!==inputHash||order.serviceObjectId!==old.id)throw new ConflictException('Ключ операции уже использован');
    return {id:old.id};
   }
   if(input.kind==='LINK'&&order.serviceObjectId===input.objectId)return {id:input.objectId};
   if(order.serviceObjectId)throw new ConflictException('Заказ уже связан с объектом');
   if(order.version!==input.orderVersion)throw new ConflictException('Заказ уже изменён. Откройте его заново');
   const object=input.kind==='CREATE'?await tx.serviceObject.create({data:{organizationId:actor.organizationId,clientId:order.clientId,name:input.name,address:input.address,creationKey:input.creationKey,inputHash}}):
    await tx.serviceObject.findFirst({where:{id:input.objectId,clientId:order.clientId,organizationId:actor.organizationId}});
   if(!object)throw new NotFoundException('Объект этого клиента не найден');
   const scope={organizationId:actor.organizationId,OR:[{id},{repeatOfId:id}]};
   if(await tx.order.findFirst({where:{...scope,serviceObjectId:{not:null}}}))throw new ConflictException('Заказ или выезд уже связан с объектом');
   await tx.order.updateMany({where:scope,data:{serviceObjectId:object.id,version:{increment:1}}});
   // Binding changes the meaning of a passport. Replace existing bearer links explicitly.
   await tx.orderPassport.updateMany({where:{organizationId:actor.organizationId,order:scope,revokedAt:null},data:{revokedAt:new Date(),revision:{increment:1},confirmedAt:null,confirmedRevision:null,confirmedOrderVersion:null}});
   await this.audit.record(tx,actor,'ORDER',id,'SERVICE_OBJECT_BOUND',{objectId:object.id});
   return {id:object.id};
  });
 }
 submit(input:ServiceRequestInput){
  const tokenHash=digest(input.token),inputHash=digest(input.description);
  return serializable(this.db.client,async tx=>{
   const link=await tx.orderPassport.findUnique({where:{tokenHash},include:{order:true}});
   if(!link||link.revokedAt||link.expiresAt<=new Date())throw new NotFoundException('Ссылка недоступна или срок истёк');
   const order=link.order;
   if(order.status!=='COMPLETED'||!order.serviceObjectId)throw new ConflictException('Повторное обращение пока недоступно');
   const old=await tx.serviceRequest.findUnique({where:{tokenHash_submissionKey:{tokenHash,submissionKey:input.submissionKey}}});
   if(old){if(old.inputHash!==inputHash)throw new ConflictException('Ключ операции уже использован');return {id:old.id};}
   if(await tx.serviceRequest.findFirst({where:{organizationId:order.organizationId,objectId:order.serviceObjectId,status:'NEW'}}))
    throw new ConflictException('По этому объекту уже есть обращение на рассмотрении');
   const request=await tx.serviceRequest.create({data:{organizationId:order.organizationId,clientId:order.clientId,objectId:order.serviceObjectId,sourceOrderId:order.id,description:input.description,submissionKey:input.submissionKey,tokenHash,inputHash}});
   await this.audit.record(tx,{id:order.id,name:'Клиент по ссылке',organizationId:order.organizationId},'ORDER',order.id,'SERVICE_REQUEST_RECEIVED',{requestId:request.id});
   return {id:request.id};
  });
 }
 decide(actor:Actor,id:string,requestId:string,input:ServiceDecisionInput){
  const decisionHash=digest(JSON.stringify({actorId:actor.id,input}));
  return serializable(this.db.client,async tx=>{
   const {order}=await this.access(tx,actor,id,true);
   const request=await tx.serviceRequest.findFirst({where:{id:requestId,organizationId:actor.organizationId,objectId:order.serviceObjectId??'00000000-0000-0000-0000-000000000000'}});
   if(!request)throw new NotFoundException('Обращение не найдено');
   if(request.status!=='NEW'){
    if(request.decisionHash!==decisionHash)throw new ConflictException('Обращение уже рассмотрено');
    return {orderId:request.convertedOrderId,status:request.status};
   }
   if(request.version!==input.version)throw new ConflictException('Обращение изменилось. Обновите данные');
   let orderId:string|null=null;
   if(input.status==='CONVERTED'){
    const org=await tx.organization.update({where:{id:actor.organizationId},data:{orderSeq:{increment:1}}});
    const price=money(cents(input.price));
    const created=await tx.order.create({data:{organizationId:actor.organizationId,clientId:request.clientId,serviceObjectId:request.objectId,number:org.orderSeq,title:input.title,notes:request.description,total:price,items:{create:{description:input.title,quantity:1,unitPrice:price,total:price}}}});
    orderId=created.id;
    await this.audit.record(tx,actor,'ORDER',orderId,'ORDER_CREATED_FROM_SERVICE_REQUEST',{requestId:request.id,total:price});
   }
   await tx.serviceRequest.update({where:{id:request.id},data:{status:input.status,version:{increment:1},convertedOrderId:orderId,decisionHash,decisionNote:input.status==='DECLINED'?input.note:'',decidedAt:new Date()}});
   await this.audit.record(tx,actor,'ORDER',request.sourceOrderId,'SERVICE_REQUEST_DECIDED',{requestId:request.id,status:input.status,orderId});
   return {orderId,status:input.status};
  });
 }
}
