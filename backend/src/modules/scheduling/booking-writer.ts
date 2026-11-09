import type {Prisma} from '@prisma/client';
import {AuditService,type Actor} from '../audit/audit.service';
import {publishTaskNotification} from '../notifications/notification-writer';
export async function releaseBooking(tx:Prisma.TransactionClient,audit:AuditService,actor:Actor,booking:{id:string;taskId:string;orderId:string},completed=false){
 const changed=await tx.workBooking.updateMany({where:{id:booking.id,organizationId:actor.organizationId,releasedAt:null},data:{releasedAt:new Date()}});
 if(!changed.count)return;
 const task=await tx.businessTask.findUniqueOrThrow({where:{id:booking.taskId}}),status=completed?'DONE':'CANCELLED';
 if(task.status!==status){
  await tx.businessTask.update({where:{id:task.id},data:{status,version:{increment:1}}});
  await audit.record(tx,actor,'TASK',task.id,'TASK_STATUS_CHANGED',{title:task.title,from:task.status,to:status});
  await publishTaskNotification(tx,{organizationId:actor.organizationId,taskId:task.id,actorId:actor.id,actorName:actor.name,kind:'TASK_STATUS_CHANGED',eventKey:'schedule:'+booking.id+':released'});
 }
 await audit.record(tx,actor,'ORDER',booking.orderId,'ORDER_ASSIGNMENT_RELEASED',{bookingId:booking.id,reason:completed?'COMPLETED':'CANCELLED'});
}
