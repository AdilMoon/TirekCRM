import {BadRequestException, ConflictException, ForbiddenException, NotFoundException} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import type {AcceptanceItem, OrderAcceptance} from '@tirek/contracts';
import type {AuthRequest} from '../../auth/session.guard';
import type {AuditService} from '../audit/audit.service';

type Actor=AuthRequest['user'];
export async function acceptanceAccess(tx:Prisma.TransactionClient, actor:Actor, orderId:string) {
  const user=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true,role:actor.role}});
  if(!user) throw new ForbiddenException();
  const order=await tx.order.findFirst({where:{id:orderId,organizationId:actor.organizationId}});
  if(!order) throw new NotFoundException('Заказ не найден');
  const task=actor.role==='EMPLOYEE' ? await tx.businessTask.findMany({where:{
    organizationId:actor.organizationId,orderId,assigneeId:actor.id,status:{in:['TODO','IN_PROGRESS']}},
    orderBy:{status:'asc'},select:{status:true}}) : [];
  if(actor.role==='EMPLOYEE' && !task.length) throw new NotFoundException('Заказ не найден');
  const open=!['COMPLETED','CANCELLED'].includes(order.status);
  return {order,canConfigure:open&&actor.role==='OWNER',
    canCheck:open&&(actor.role==='OWNER'||task.some(row=>row.status==='IN_PROGRESS'))};
}
export async function acceptanceState(tx:Prisma.TransactionClient, orderId:string) {
  const row=await tx.orderAcceptance.findUnique({where:{orderId}});
  return {version:row?.version??0,items:(row?.items??[]) as unknown as AcceptanceItem[]};
}
export async function readAcceptance(tx:Prisma.TransactionClient, actor:Actor, orderId:string):Promise<OrderAcceptance> {
  const access=await acceptanceAccess(tx,actor,orderId);
  return {...await acceptanceState(tx,orderId),canConfigure:access.canConfigure,canCheck:access.canCheck};
}
export async function requireAcceptance(tx:Prisma.TransactionClient, organizationId:string, orderId:string) {
  const row=await tx.orderAcceptance.findFirst({where:{orderId,organizationId}});
  const items=(row?.items??[]) as unknown as AcceptanceItem[];
  if(items.some(item=>item.required&&!item.checked)) throw new BadRequestException('Сначала выполните обязательные пункты приёмки');
}
export async function checkAcceptance(tx:Prisma.TransactionClient,audit:AuditService,actor:Actor,orderId:string,
  input:{version:number;itemId:string;checked:boolean}) {
  const access=await acceptanceAccess(tx,actor,orderId);
  if(!access.canCheck) throw new ForbiddenException('Отметки доступны во время работы по заказу');
  const state=await acceptanceState(tx,orderId);
  const item=state.items.find(item=>item.id===input.itemId);
  if(!item) throw new NotFoundException('Пункт приёмки не найден');
  if(item.checked===input.checked) return readAcceptance(tx,actor,orderId);
  if(state.version!==input.version) throw new ConflictException('Чек-лист изменился. Обновите данные');
  const items=state.items.map(row=>({...row,checked:row.id===item.id?input.checked:row.checked,
    checkedBy:row.id===item.id?(input.checked?actor.name:null):row.checkedBy}));
  await tx.orderAcceptance.update({where:{orderId},data:{version:{increment:1},items}});
  await audit.record(tx,actor,'ORDER',orderId,'ACCEPTANCE_CHECKED',{itemId:item.id,label:item.label,checked:input.checked});
  return readAcceptance(tx,actor,orderId);
}
