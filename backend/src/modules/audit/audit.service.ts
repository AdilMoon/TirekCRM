import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditQuery } from '@tirek/contracts';
import { Database } from '../../database/database.service';
export type Actor = { id:string; name:string; organizationId:string };
@Injectable()
export class AuditService {
 constructor(private readonly db:Database) {}
 record(tx:Prisma.TransactionClient,actor:Actor,entityType:string,entityId:string,action:string,metadata:Prisma.InputJsonObject={}) {
  return tx.auditEvent.create({data:{organizationId:actor.organizationId,actorId:actor.id,actorName:actor.name,entityType,entityId,action,metadata}});
 }
 async list(org:string,query:AuditQuery) {
  const where:Prisma.AuditEventWhereInput={organizationId:org,...(query.entityType?{entityType:query.entityType}:{}),...(query.entityId?{entityId:query.entityId}:{})};
  const [items,total]=await this.db.client.$transaction([
   this.db.client.auditEvent.findMany({where,select:{id:true,actorName:true,entityType:true,entityId:true,action:true,metadata:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),
   this.db.client.auditEvent.count({where}),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  return {items,total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize)};
 }
}
