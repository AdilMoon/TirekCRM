import type { NotificationKind, Prisma } from '@prisma/client';

async function queueTelegram(tx: Prisma.TransactionClient, organizationId: string, eventKey: string, kind: NotificationKind) {
 const notifications = await tx.notification.findMany({
  where: { organizationId, eventKey, kind, recipient: { isActive: true, role: 'EMPLOYEE' } },
  select: { id: true, recipient: { select: { telegramLink: { select: { id: true } } } } },
 });
 const now = new Date();
 const data = notifications.flatMap(notification => notification.recipient.telegramLink
  ? [{ organizationId, linkId: notification.recipient.telegramLink.id, notificationId: notification.id, createdAt: now, nextAttemptAt: now }]
  : []);
 if (data.length) await tx.telegramDelivery.createMany({ data, skipDuplicates: true });
}

export async function publishQuoteNotifications(tx: Prisma.TransactionClient, quote: { id: string; organizationId: string; orderId: string }) {
 const tasks = await tx.businessTask.findMany({
  where: {
   organizationId: quote.organizationId, orderId: quote.orderId, status: { in: ['TODO', 'IN_PROGRESS'] },
   assignee: { isActive: true, role: 'EMPLOYEE' },
  },
  select: { id: true, assigneeId: true },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  distinct: ['assigneeId'],
 });
 if (!tasks.length) return;
 const eventKey = 'quote:' + quote.id + ':accepted';
 const kind = 'ORDER_QUOTE_ACCEPTED';
 await tx.notification.createMany({
  data: tasks.map(task => ({
   organizationId: quote.organizationId, taskId: task.id, recipientId: task.assigneeId, orderQuoteId: quote.id,
   kind, eventKey, actorName: 'Клиент по ссылке', createdAt: new Date(),
  })),
  skipDuplicates: true,
 });
 await queueTelegram(tx, quote.organizationId, eventKey, kind);
}

// Called only inside the transaction that commits the source event.
export async function publishTaskNotification(tx:Prisma.TransactionClient, event:{
 organizationId:string;taskId:string;actorId:string;actorName:string;kind:Exclude<NotificationKind,'ORDER_QUOTE_ACCEPTED'>;eventKey:string;
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
 if(event.kind==='TASK_ASSIGNED')await queueTelegram(tx,event.organizationId,event.eventKey,event.kind);
}

export async function removeFormerAssigneeNotifications(tx:Prisma.TransactionClient,organizationId:string,taskId:string,assigneeId:string) {
 await tx.notification.deleteMany({where:{organizationId,taskId,recipient:{role:'EMPLOYEE',id:{not:assigneeId}}}});
}
