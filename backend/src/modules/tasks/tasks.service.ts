import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TaskInput, TaskUpdateInput, TaskQuery, TaskStatus } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import type { AuthRequest } from '../../auth/session.guard';
import { serializable } from '../../common/transaction';
type Actor=AuthRequest['user'];
// Deliberately select only operational fields: employees never receive financial or client data.
const taskSelect={id:true,title:true,description:true,status:true,version:true,dueDate:true,createdAt:true,updatedAt:true,
 assignee:{select:{id:true,name:true,isActive:true}},order:{select:{id:true,number:true,title:true}}} as const;
@Injectable()
export class TasksService {
 constructor(private readonly db:Database,private readonly audit:AuditService) {}
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
   return task;
  });
 }
 update(actor:Actor,id:string,input:TaskUpdateInput) {
  return serializable(this.db.client,async tx=>{
   const previous=await tx.businessTask.findFirst({where:{id,organizationId:actor.organizationId}});
   if(!previous)throw new NotFoundException('Задача не найдена');
   if(previous.version!==input.version)throw new ConflictException('Задача уже изменена. Обновите список');
   await this.references(tx,actor.organizationId,input);
   const task=await tx.businessTask.update({where:{id},data:{...input,version:{increment:1},dueDate:input.dueDate?new Date(input.dueDate+'T00:00:00Z'):null},select:taskSelect});
   await this.audit.record(tx,actor,'TASK',id,'TASK_UPDATED',{title:task.title,assignee:task.assignee.name});
   return task;
  });
 }
 status(actor:Actor,id:string,status:TaskStatus,version:number) {
  return serializable(this.db.client,async tx=>{
   // Recheck active access in the transaction, including concurrent account deactivation.
   const current=await tx.user.findUnique({where:{id:actor.id}});
   if(!current?.isActive)throw new ForbiddenException('Доступ сотрудника отключён');
   const previous=await tx.businessTask.findFirst({where:{...this.scope(actor),id}});
   if(!previous)throw new NotFoundException('Задача не найдена');
   if(previous.version!==version)throw new ConflictException('Задача уже изменена. Обновите список');
   const employeeTransitions:Record<TaskStatus,TaskStatus[]>={TODO:['IN_PROGRESS'],IN_PROGRESS:['TODO','DONE'],DONE:[],CANCELLED:[]};
   if(actor.role==='EMPLOYEE'&&!employeeTransitions[previous.status].includes(status))throw new ForbiddenException('Этот переход задачи недоступен');
   if(previous.status===status)return tx.businessTask.findUniqueOrThrow({where:{id},select:taskSelect});
   const task=await tx.businessTask.update({where:{id},data:{status,version:{increment:1}},select:taskSelect});
   await this.audit.record(tx,actor,'TASK',id,'TASK_STATUS_CHANGED',{title:task.title,from:previous.status,to:status});
   return task;
  });
 }
}
