import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TaskCommentInput, TaskCommentQuery } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import type { AuthRequest } from '../../auth/session.guard';
import { serializable } from '../../common/transaction';

type Actor = AuthRequest['user'];
const commentSelect = { id:true, body:true, authorId:true, authorName:true, createdAt:true } as const;

@Injectable()
export class TaskCommentsService {
 constructor(private readonly db:Database, private readonly audit:AuditService) {}

 private async authorize(tx:Prisma.TransactionClient, actor:Actor, taskId:string) {
  // Access and the comment are read/written in the same database snapshot.
  const user = await tx.user.findFirst({where:{id:actor.id, organizationId:actor.organizationId, isActive:true}});
  if (!user) throw new ForbiddenException('Доступ сотрудника отключён');
  const task = await tx.businessTask.findFirst({where:{id:taskId, organizationId:user.organizationId,
   ...(user.role === 'EMPLOYEE' ? {assigneeId:user.id} : {})}, select:{id:true}});
  if (!task) throw new NotFoundException('Задача не найдена');
  return user;
 }

 list(actor:Actor, taskId:string, query:TaskCommentQuery) {
  return this.db.client.$transaction(async tx => {
   await this.authorize(tx, actor, taskId);
   const where = {organizationId:actor.organizationId, taskId};
   const items = await tx.taskComment.findMany({where, select:commentSelect,
    orderBy:[{createdAt:'desc'}, {id:'desc'}], skip:(query.page-1)*query.pageSize, take:query.pageSize});
   const total = await tx.taskComment.count({where});
   return {items, total, page:query.page, pageSize:query.pageSize, pages:Math.ceil(total/query.pageSize)};
  }, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }

 create(actor:Actor, taskId:string, input:TaskCommentInput) {
  return serializable(this.db.client, async tx => {
   const user = await this.authorize(tx, actor, taskId);
   const previous = await tx.taskComment.findUnique({where:{organizationId_authorId_idempotencyKey:{
    organizationId:user.organizationId, authorId:user.id, idempotencyKey:input.idempotencyKey}}});
   if (previous) {
    if (previous.taskId !== taskId || previous.body !== input.body)
     throw new ConflictException('Этот запрос уже использован для другого комментария');
    return {id:previous.id, body:previous.body, authorId:previous.authorId, authorName:previous.authorName, createdAt:previous.createdAt};
   }
   const comment = await tx.taskComment.create({data:{...input, taskId, organizationId:user.organizationId,
    authorId:user.id, authorName:user.name}, select:commentSelect});
   await this.audit.record(tx, user, 'TASK', taskId, 'TASK_COMMENT_ADDED', {commentId:comment.id});
   return comment;
  });
 }
}
