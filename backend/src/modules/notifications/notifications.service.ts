import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { NotificationQuery } from '@tirek/contracts';
import type { AuthRequest } from '../../auth/session.guard';
import { Database } from '../../database/database.service';
import { serializable } from '../../common/transaction';

@Injectable()
export class NotificationsService {
 constructor(private readonly db:Database) {}
 private async scope(tx:Prisma.TransactionClient,actor:AuthRequest['user']):Promise<Prisma.NotificationWhereInput> {
  const user=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true},select:{id:true,role:true,organizationId:true}});
  if(!user)throw new ForbiddenException('Доступ сотрудника отключён');
  return {organizationId:user.organizationId,recipientId:user.id,
   task:{organizationId:user.organizationId,...(user.role==='EMPLOYEE'?{assigneeId:user.id}:{})}};
 }
 list(actor:AuthRequest['user'],query:NotificationQuery) {
  return this.db.client.$transaction(async tx=>{
   const scope=await this.scope(tx,actor);
   const where={...scope,...(query.unread==='true'?{readAt:null}:{})};
   const items=await tx.notification.findMany({where,select:{id:true,kind:true,actorName:true,taskStatus:true,createdAt:true,readAt:true,task:{select:{id:true,title:true}}},
    orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize});
   const total=await tx.notification.count({where});
   const unreadCount=await tx.notification.count({where:{...scope,readAt:null}});
   return {items,total,unreadCount,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize)};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 unread(actor:AuthRequest['user']) {
  return this.db.client.$transaction(async tx=>{
   const scope=await this.scope(tx,actor);
   return {unreadCount:await tx.notification.count({where:{...scope,readAt:null}})};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 read(actor:AuthRequest['user'],ids:string[]) {
  return serializable(this.db.client,async tx=>{
   const scope=await this.scope(tx,actor),where={...scope,id:{in:ids}};
   if(await tx.notification.count({where})!==ids.length)throw new NotFoundException('Уведомление недоступно. Обновите список');
   // Never rewrite readAt on a retry, or mark newly arriving notifications read.
   await tx.notification.updateMany({where:{...where,readAt:null},data:{readAt:new Date()}});
   return {ok:true};
  });
 }
}
