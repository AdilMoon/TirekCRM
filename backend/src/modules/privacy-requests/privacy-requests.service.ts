import {createHash} from 'node:crypto';
import {ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma,type PrivacyRequest} from '@prisma/client';
import type {PrivacyRequestInput,PrivacyRequestChange,PrivacyRequestQuery} from '@tirek/contracts';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {AuditService,Actor} from '../audit/audit.service';

const day=(date:Date)=>date.toISOString().slice(0,10);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const terminal=(status:string)=>status==='RESOLVED'||status==='REJECTED';
function summary(row:PrivacyRequest,todayOn:string){return {id:row.id,kind:row.kind,status:row.status,subjectName:row.subjectName,receivedOn:day(row.receivedOn),dueOn:row.dueOn?day(row.dueOn):null,version:row.version,createdAt:row.createdAt,overdue:!terminal(row.status)&&!!row.dueOn&&day(row.dueOn)<todayOn};}
function detail(row:PrivacyRequest){return {...summary(row,today()),contact:row.contact,description:row.description,resolution:row.resolution,createdByName:row.createdByName,closedAt:row.closedAt,updatedAt:row.updatedAt};}

@Injectable()
export class PrivacyRequestsService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 private async owner(tx:Prisma.TransactionClient,actor:Actor){
  const user=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,role:'OWNER',isActive:true}});
  if(!user)throw new ForbiddenException('Недостаточно прав');
  return {id:user.id,organizationId:user.organizationId,name:user.name};
 }
 async list(org:string,input:PrivacyRequestQuery){
  const todayOn=today();
  const where:Prisma.PrivacyRequestWhereInput={organizationId:org,
   ...(input.status?{status:input.status}:{}),
   ...(input.overdue==='true'?{dueOn:{lt:new Date(todayOn)},NOT:{status:{in:['RESOLVED','REJECTED']}}}:{}),
   ...(input.q?{subjectName:{contains:input.q,mode:'insensitive'}}:{}),
  };
  const [items,total]=await this.db.client.$transaction([
   this.db.client.privacyRequest.findMany({where,orderBy:[{dueOn:{sort:'asc',nulls:'last'}},{createdAt:'desc'},{id:'desc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),
   this.db.client.privacyRequest.count({where}),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  return {items:items.map(row=>summary(row,todayOn)),total,page:input.page,pageSize:input.pageSize,pages:Math.ceil(total/input.pageSize)};
 }
 async get(org:string,id:string){
  const row=await this.db.client.privacyRequest.findFirst({where:{id,organizationId:org}});
  if(!row)throw new NotFoundException('Обращение не найдено');
  return detail(row);
 }
 async create(actor:Actor,input:PrivacyRequestInput){
  return serializable(this.db.client,async tx=>{
   const owner=await this.owner(tx,actor),org=owner.organizationId;
   const previous=await tx.privacyRequest.findUnique({where:{organizationId_creationKey:{organizationId:org,creationKey:input.idempotencyKey}}});
   if(previous){
    if(previous.createdById!==owner.id||previous.kind!==input.kind||previous.subjectName!==input.subjectName||previous.contact!==input.contact||previous.description!==input.description||day(previous.receivedOn)!==input.receivedOn||(previous.dueOn?day(previous.dueOn):null)!==input.dueOn)
     throw new ConflictException('Этот ключ уже использован для другого обращения');
    return detail(previous);
   }
   if(input.receivedOn>today())throw new ConflictException('Дата получения не может быть в будущем');
   const row=await tx.privacyRequest.create({data:{organizationId:org,kind:input.kind,subjectName:input.subjectName,contact:input.contact,description:input.description,receivedOn:new Date(input.receivedOn),dueOn:input.dueOn?new Date(input.dueOn):null,creationKey:input.idempotencyKey,createdById:owner.id,createdByName:owner.name}});
   await this.audit.record(tx,owner,'PRIVACY_REQUEST',row.id,'PRIVACY_REQUEST_CREATED',{kind:row.kind,status:row.status});
   return detail(row);
  });
 }
 async change(actor:Actor,id:string,input:PrivacyRequestChange){
  return serializable(this.db.client,async tx=>{
   const owner=await this.owner(tx,actor),org=owner.organizationId;
   const row=await tx.privacyRequest.findFirst({where:{id,organizationId:org}});
   if(!row)throw new NotFoundException('Обращение не найдено');
   const inputHash=createHash('sha256').update(JSON.stringify({version:input.version,status:input.status,resolution:input.resolution})).digest('hex');
   const receipt=await tx.privacyRequestChangeReceipt.findUnique({where:{organizationId_idempotencyKey:{organizationId:org,idempotencyKey:input.idempotencyKey}}});
   if(receipt){
    if(receipt.requestId!==id||receipt.actorId!==owner.id||receipt.inputHash!==inputHash)
     throw new ConflictException('Этот ключ уже использован для другого изменения обращения');
    // A retry acknowledges the committed operation but returns the current state, never an old version.
    return detail(row);
   }
   if(row.version!==input.version)throw new ConflictException('Обращение уже изменено. Откройте его заново');
   if(terminal(row.status)||row.status===input.status)throw new ConflictException('Этот переход обращения недоступен');
   const updated=await tx.privacyRequest.update({where:{id:row.id},data:{status:input.status,resolution:input.resolution,closedAt:terminal(input.status)?new Date():null,version:{increment:1}}});
   await tx.privacyRequestChangeReceipt.create({data:{organizationId:org,requestId:id,idempotencyKey:input.idempotencyKey,actorId:owner.id,inputHash}});
   await this.audit.record(tx,owner,'PRIVACY_REQUEST',row.id,'PRIVACY_REQUEST_CHANGED',{from:row.status,to:updated.status});
   return detail(updated);
  });
 }
}
