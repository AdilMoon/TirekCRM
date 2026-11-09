import type { NotificationKind, Prisma } from '@prisma/client';

// Called only inside the transaction that commits the source event.
export async function publishTaskNotification(tx:Prisma.TransactionClient, event:{
 organizationId:string;taskId:string;actorId:string;actorName:string;kind:NotificationKind;eventKey:string;
}) {
 const task=await tx.businessTask.findFirstOrThrow({where:{id:event.taskId,organizationId:event.organizationId},select:{assigneeId:true,status:true}});
 const recipients=await tx.user.findMany({where:{organizationId:event.organizationId,isActive:true,id:{not:event.actorId},
  OR:event.kind==='TASK_ASSIGNED'?[{id:task.assigneeId}]:[{role:'OWNER'},{id:task.assigneeId}]},select:{id:true}});
 if(!recipients.length)return;
 await tx.notification.createMany({data:recipients.map(recipient=>({
  organizationId:event.organizationId,taskId:event.taskId,recipientId:recipient.id,
  kind:event.kind,eventKey:event.eventKey,actorName:event.actorName,
  taskStatus:event.kind==='TASK_STATUS_CHANGED'?task.status:null,
 })),skipDuplicates:true});
 if(event.kind==='TASK_ASSIGNED'){
  const links=await tx.telegramLink.findMany({where:{organizationId:event.organizationId,userId:{in:recipients.map(r=>r.id)},user:{isActive:true,role:'EMPLOYEE'}},select:{id:true,userId:true}});
  if(links.length){
   const notifications=await tx.notification.findMany({where:{organizationId:event.organizationId,eventKey:event.eventKey,kind:'TASK_ASSIGNED',recipientId:{in:links.map(l=>l.userId)}},select:{id:true,recipientId:true}});
   await tx.telegramDelivery.createMany({data:notifications.map(n=>({organizationId:event.organizationId,linkId:links.find(l=>l.userId===n.recipientId)!.id,notificationId:n.id,createdAt:new Date(),nextAttemptAt:new Date()})),skipDuplicates:true});
  }
 }
}

export async function removeFormerAssigneeNotifications(tx:Prisma.TransactionClient,organizationId:string,taskId:string,assigneeId:string) {
 await tx.notification.deleteMany({where:{organizationId,taskId,recipient:{role:'EMPLOYEE',id:{not:assigneeId}}}});
}
