import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TaskInput, TaskUpdateInput, TaskQuery, TaskStatus } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import type { AuthRequest } from '../../auth/session.guard';
import { serializable } from '../../common/transaction';
import { publishTaskNotification,removeFormerAssigneeNotifications } from '../notifications/notification-writer';
import {requireAcceptance,readAcceptance,checkAcceptance} from './acceptance';
type Actor=AuthRequest['user'];
// Deliberately select only operational fields: employees never receive financial or client data.
const taskSelect={id:true,title:true,description:true,status:true,version:true,dueDate:true,createdAt:true,updatedAt:true,
 booking:{select:{startsAt:true,endsAt:true,releasedAt:true}},
 assignee:{select:{id:true,name:true,isActive:true}},order:{select:{id:true,number:true,title:true}}} as const;
@Injectable()
export class TasksService {
 constructor(private readonly db:Database,private readonly audit:AuditService) {}
 acceptance(actor:Actor,orderId:string) {
  return this.db.client.$transaction(tx=>readAcceptance(tx,actor,orderId),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 checkAcceptance(actor:Actor,orderId:string,input:{version:number;itemId:string;checked:boolean},
   telegram:{linkId:string;botId:string;telegramUserId:string}) {
  return serializable(this.db.client,async tx=>{
   if(!await tx.telegramLink.findFirst({where:{id:telegram.linkId,userId:actor.id,organizationId:actor.organizationId,
     botId:telegram.botId,telegramUserId:telegram.telegramUserId}})) throw new ForbiddenException();
   return checkAcceptance(tx,this.audit,actor,orderId,input);
  });
 }
 private scope(actor:Actor):Prisma.BusinessTaskWhereInput {
  return {organizationId:actor.organizationId,...(actor.role==='EMPLOYEE'?{assigneeId:actor.id}:{})};
 }
 async list(actor:Actor,query:TaskQuery) {
  const where:Prisma.BusinessTaskWhereInput={...this.scope(actor),...(query.status?{status:query.status}:{}),...(query.orderId?{orderId:query.orderId}:{}),
   ...(actor.role==='OWNER'&&query.assigneeId?{assigneeId:query.assigneeId}:{}),
   ...(query.q?{OR:[{title:{contains:query.q,mode:'insensitive'}},{description:{contains:query.q,mode:'insensitive'}}]}:{})};
  const [items,total]=await this.db.client.$transaction([
   this.db.client.businessTask.findMany({where,select:taskSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),
   this.db.client.businessTask.count({where}),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  return {items,total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize)};
 }
 async get(actor:Actor,id:string) {
  const task=await this.db.client.businessTask.findFirst({where:{...this.scope(actor),id},select:taskSelect});
  if(!task)throw new NotFoundException('Задача не найдена');
  return task;
 }
 private async references(tx:Prisma.TransactionClient,org:string,input:TaskInput) {
  if(!await tx.user.findFirst({where:{id:input.assigneeId,organizationId:org,isActive:true}}))throw new NotFoundException('Активный исполнитель не найден');
  if(input.orderId&&!await tx.order.findFirst({where:{id:input.orderId,organizationId:org}}))throw new NotFoundException('Заказ не найден');
 }
 create(actor:Actor,input:TaskInput) {
  return serializable(this.db.client,async tx=>{
   await this.references(tx,actor.organizationId,input);
   const task=await tx.businessTask.create({data:{...input,organizationId:actor.organizationId,createdById:actor.id,dueDate:input.dueDate?new Date(input.dueDate+'T00:00:00Z'):null},select:taskSelect});
   await this.audit.record(tx,actor,'TASK',task.id,'TASK_CREATED',{title:task.title,assignee:task.assignee.name});
   await publishTaskNotification(tx,{organizationId:actor.organizationId,taskId:task.id,actorId:actor.id,actorName:actor.name,kind:'TASK_ASSIGNED',eventKey:'task:'+task.id+':assigned:'+task.version});
   return task;
  });
 }
 update(actor:Actor,id:string,input:TaskUpdateInput) {
  return serializable(this.db.client,async tx=>{
   const previous=await tx.businessTask.findFirst({where:{id,organizationId:actor.organizationId}});
   if(!previous)throw new NotFoundException('Задача не найдена');
   if(previous.version!==input.version)throw new ConflictException('Задача уже изменена. Обновите список');
   const booking=await tx.workBooking.findFirst({where:{taskId:id,organizationId:actor.organizationId,releasedAt:null}});
   if(booking&&(input.assigneeId!==booking.employeeId||input.orderId!==booking.orderId))throw new ConflictException('Измените исполнителя через распределение заказа');
   await this.references(tx,actor.organizationId,input);
   const task=await tx.businessTask.update({where:{id},data:{...input,version:{increment:1},dueDate:input.dueDate?new Date(input.dueDate+'T00:00:00Z'):null},select:taskSelect});
   await this.audit.record(tx,actor,'TASK',id,'TASK_UPDATED',{title:task.title,assignee:task.assignee.name});
   if(previous.assigneeId!==task.assignee.id){
    await removeFormerAssigneeNotifications(tx,actor.organizationId,id,task.assignee.id);
    await publishTaskNotification(tx,{organizationId:actor.organizationId,taskId:id,actorId:actor.id,actorName:actor.name,kind:'TASK_ASSIGNED',eventKey:'task:'+id+':assigned:'+task.version});
   }
   return task;
  });
 }
 status(actor:Actor,id:string,status:TaskStatus,version:number,telegram?:{linkId:string;botId:string;telegramUserId:string}) {
  return serializable(this.db.client,async tx=>{
   // Recheck active access in the transaction, including concurrent account deactivation.
   const current=await tx.user.findUnique({where:{id:actor.id}});
   if(!current?.isActive||current.organizationId!==actor.organizationId||current.role!==actor.role)throw new ForbiddenException('Доступ сотрудника отключён');
   if(telegram&&(current.role!=='EMPLOYEE'||!await tx.telegramLink.findFirst({where:{id:telegram.linkId,userId:actor.id,organizationId:actor.organizationId,botId:telegram.botId,telegramUserId:telegram.telegramUserId}})))throw new ForbiddenException('Подключение Telegram отключено');
   const previous=await tx.businessTask.findFirst({where:{...this.scope(actor),id}});
   if(!previous)throw new NotFoundException('Задача не найдена');
   // A replay may acknowledge the immediately committed result, never advance it again.
   if(telegram&&previous.version===version+1&&previous.status===status)return tx.businessTask.findUniqueOrThrow({where:{id},select:taskSelect});
   if(previous.version!==version)throw new ConflictException('Задача уже изменена. Обновите список');
   const employeeTransitions:Record<TaskStatus,TaskStatus[]>={TODO:['IN_PROGRESS'],IN_PROGRESS:['TODO','DONE'],DONE:[],CANCELLED:[]};
   if(actor.role==='EMPLOYEE'&&!employeeTransitions[previous.status].includes(status))throw new ForbiddenException('Этот переход задачи недоступен');
   if(previous.status===status)return tx.businessTask.findUniqueOrThrow({where:{id},select:taskSelect});
   if(status==='DONE' && previous.orderId) await requireAcceptance(tx,actor.organizationId,previous.orderId);
   if(status==='CANCELLED'&&await tx.workBooking.findFirst({where:{taskId:id,organizationId:actor.organizationId,releasedAt:null}}))throw new ConflictException('Сначала отмените назначение в карточке заказа');
   if(['TODO','IN_PROGRESS'].includes(status)&&await tx.workBooking.findFirst({where:{taskId:id,releasedAt:{not:null}}}))throw new ConflictException('Освобождённое назначение нельзя вернуть через задачу');
   const task=await tx.businessTask.update({where:{id},data:{status,version:{increment:1}},select:taskSelect});
   if(telegram&&status==='DONE')await tx.telegramLink.updateMany({where:{id:telegram.linkId,selectedTaskId:id},data:{selectedTaskId:null,selectedAt:null,selectedReceiptOrderId:null}});
   await this.audit.record(tx,actor,'TASK',id,'TASK_STATUS_CHANGED',{title:task.title,from:previous.status,to:status,...(telegram?{source:'TELEGRAM'}:{})});
   await publishTaskNotification(tx,{organizationId:actor.organizationId,taskId:id,actorId:actor.id,actorName:actor.name,kind:'TASK_STATUS_CHANGED',eventKey:'task:'+id+':status:'+task.version});
   return task;
  });
 }
}
