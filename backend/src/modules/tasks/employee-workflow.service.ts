import {ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {AcceptanceItem} from '@tirek/contracts';
import type {AuthRequest} from '../../auth/session.guard';
import {Database} from '../../database/database.service';
import {taskSelect} from './tasks.service';
type Actor=AuthRequest['user'];
@Injectable()
export class EmployeeWorkflowService {
 constructor(private readonly db:Database){}
 private async access(tx:Prisma.TransactionClient,actor:Actor){
  if(actor.role!=='EMPLOYEE')throw new ForbiddenException('Недостаточно прав');
  if(!await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,role:'EMPLOYEE',isActive:true},select:{id:true}}))
   throw new ForbiddenException('Недостаточно прав');
 }
 private scope(actor:Actor){return {organizationId:actor.organizationId,assigneeId:actor.id,status:{not:'CANCELLED' as const},
  OR:[{orderId:null},{order:{status:{not:'CANCELLED' as const}}}]};}
 private async read(tx:Prisma.TransactionClient,actor:Actor,id:string){
  const task=await tx.businessTask.findFirst({where:{...this.scope(actor),id},select:taskSelect});
  if(!task)throw new NotFoundException('Задача не найдена');
  let resultPhotos=0,submittedMinutes=0,approvedMinutes=0,requiredChecks=0,completedChecks=0;
  if(task.order){
   resultPhotos=await tx.orderPhoto.count({where:{organizationId:actor.organizationId,orderId:task.order.id,createdById:actor.id,phase:'AFTER'}});
   const [totals]=await tx.$queryRaw<{submitted:bigint;approved:bigint}[]>(Prisma.sql`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (e."endsAt"-e."startsAt"))/60) FILTER(WHERE e.status='SUBMITTED'),0)::bigint AS submitted,
           COALESCE(SUM(EXTRACT(EPOCH FROM (e."endsAt"-e."startsAt"))/60) FILTER(WHERE e.status='APPROVED'),0)::bigint AS approved
    FROM "WorkTimeAllocation" a JOIN "WorkTimeEntry" e ON e.id=a."entryId" AND e."organizationId"=a."organizationId"
    WHERE a."organizationId"=${actor.organizationId}::uuid AND a."orderId"=${task.order.id}::uuid
      AND e."employeeId"=${actor.id}::uuid AND e.kind<>'ABSENCE'`);
   submittedMinutes=Number(totals.submitted);approvedMinutes=Number(totals.approved);
   const acceptance=await tx.orderAcceptance.findFirst({where:{organizationId:actor.organizationId,orderId:task.order.id},select:{items:true}});
   const checks=((acceptance?.items??[]) as unknown as AcceptanceItem[]).filter(item=>item.required);
   requiredChecks=checks.length;completedChecks=checks.filter(item=>item.checked).length;
  }
  return {task,resultPhotos,submittedMinutes,approvedMinutes,requiredChecks,completedChecks};
 }
 first(actor:Actor){
  return this.db.client.$transaction(async tx=>{
   await this.access(tx,actor);
   const task=await tx.businessTask.findFirst({where:this.scope(actor),orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true}});
   return {workflow:task?await this.read(tx,actor,task.id):null};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 detail(actor:Actor,id:string){
  return this.db.client.$transaction(async tx=>{await this.access(tx,actor);return this.read(tx,actor,id);},
   {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
}
