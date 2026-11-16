import {Injectable,ForbiddenException,NotFoundException,ConflictException,BadRequestException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {WorkProfileInput,AssignmentSlot,AssignOrderInput,AssignmentCandidate} from '@tirek/contracts';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {digest} from '../../auth/session.guard';
import {AuditService,type Actor} from '../audit/audit.service';
import {publishTaskNotification} from '../notifications/notification-writer';
import {almatyTime,fitsProfile,rankCandidates,slotDates} from './planner';
import {releaseBooking} from './booking-writer';
const bookingSelect={id:true,employeeId:true,employee:{select:{name:true}},startsAt:true,endsAt:true,requiredSkills:true,taskId:true,releasedAt:true} as const;
const profileSelect={skills:true,weekdays:true,startMinute:true,endMinute:true,version:true} as const;
const stale=()=>new ConflictException('Расписание изменилось. Обновите подбор исполнителей');
@Injectable()
export class SchedulingService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 private async owner(tx:Prisma.TransactionClient,actor:Actor){
  if(!await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true,role:'OWNER'}}))throw new ForbiddenException('Недостаточно прав');
 }
 private async order(tx:Prisma.TransactionClient,actor:Actor,id:string){
  await this.owner(tx,actor);
  const order=await tx.order.findFirst({where:{id,organizationId:actor.organizationId}});
  if(!order)throw new NotFoundException('Заказ не найден');return order;
 }
 members(actor:Actor){return serializable(this.db.client,async tx=>{await this.owner(tx,actor);return tx.user.findMany({where:{organizationId:actor.organizationId,role:'EMPLOYEE'},select:{id:true,name:true,isActive:true,workProfile:{select:profileSelect}},orderBy:[{name:'asc'},{id:'asc'}]}).then(rows=>rows.map(({workProfile,...r})=>({...r,profile:workProfile})));});}
 profile(actor:Actor,id:string,input:WorkProfileInput){return serializable(this.db.client,async tx=>{
  await this.owner(tx,actor);
  if(!await tx.user.findFirst({where:{id,organizationId:actor.organizationId,role:'EMPLOYEE'}}))throw new NotFoundException('Сотрудник не найден');
  const previous=await tx.workProfile.findUnique({where:{userId:id}});
  if((previous?.version??0)!==input.version)throw stale();
  const bookings=await tx.workBooking.findMany({where:{employeeId:id,organizationId:actor.organizationId,releasedAt:null,endsAt:{gt:new Date()}}});
  if(bookings.some(b=>!fitsProfile(input,b.startsAt,(b.endsAt.getTime()-b.startsAt.getTime())/60000,b.requiredSkills)))throw new ConflictException('Сначала переназначьте заказы, не подходящие новому графику или навыкам');
  const {version,...data}=input;
  const profile=await tx.workProfile.upsert({where:{userId:id},create:{userId:id,organizationId:actor.organizationId,...data},update:{...data,version:{increment:1}},select:profileSelect});
  await this.audit.record(tx,actor,'TEAM',id,'WORK_PROFILE_UPDATED',{version:profile.version});return profile;
 });}
 state(actor:Actor,id:string){return serializable(this.db.client,async tx=>{
  const order=await this.order(tx,actor,id),current=await tx.workBooking.findFirst({where:{orderId:id,organizationId:actor.organizationId,releasedAt:null},select:bookingSelect});
  return {orderVersion:order.version,status:order.status,current};
 });}
 private async plan(tx:Prisma.TransactionClient,actor:Actor,id:string,slot:AssignmentSlot){
  const order=await this.order(tx,actor,id),{start,end}=slotDates(slot),now=Date.now(),local=almatyTime(start);
  if(['COMPLETED','CANCELLED'].includes(order.status))throw new ConflictException('Завершённый или отменённый заказ нельзя назначить');
  if(start.getTime()<=now||start.getTime()>now+90*86400000)throw new BadRequestException('Выберите будущее время в пределах 90 дней');
  if(local.minute+slot.durationMinutes>1440)throw new BadRequestException('Работа должна завершиться в пределах одного дня Алматы');
  if(order.dueDate&&local.day>order.dueDate.toISOString().slice(0,10))throw new ConflictException('Интервал позже срока заказа. Сначала измените срок заказа');
  const current=await tx.workBooking.findFirst({where:{orderId:id,organizationId:actor.organizationId,releasedAt:null},select:bookingSelect});
  const members=await tx.user.findMany({where:{organizationId:actor.organizationId,role:'EMPLOYEE'},include:{workProfile:true},take:201});
  if(members.length>200)throw new BadRequestException('Подбор поддерживает до 200 сотрудников');
  const dayStart=new Date(start.getTime()-local.minute*60000),dayEnd=new Date(dayStart.getTime()+86400000);
  const bookings=await tx.workBooking.findMany({where:{organizationId:actor.organizationId,releasedAt:null,orderId:{not:id},startsAt:{lt:dayEnd},endsAt:{gt:dayStart}},select:{employeeId:true,startsAt:true,endsAt:true}});
  const tasks=await tx.businessTask.groupBy({by:['assigneeId'],where:{organizationId:actor.organizationId,status:{in:['TODO','IN_PROGRESS']},...(current?{id:{not:current.taskId}}:{})},_count:true});
  const candidates:AssignmentCandidate[]=members.map(user=>{
   const profile=user.workProfile,own=bookings.filter(b=>b.employeeId===user.id),missingSkills=slot.requiredSkills.filter(s=>!profile?.skills.includes(s)),blocks:AssignmentCandidate['blocks']=[];
   if(!user.isActive)blocks.push('INACTIVE');if(!profile)blocks.push('PROFILE_REQUIRED');
   else{if(missingSkills.length)blocks.push('MISSING_SKILLS');if(!fitsProfile(profile,start,slot.durationMinutes,[]))blocks.push('OUTSIDE_HOURS');}
   if(own.some(b=>b.startsAt<end&&b.endsAt>start))blocks.push('OVERLAP');
   return {id:user.id,name:user.name,profileVersion:profile?.version??null,eligible:!blocks.length,blocks,missingSkills,workloadMinutes:own.reduce((n,b)=>n+(Math.min(b.endsAt.getTime(),dayEnd.getTime())-Math.max(b.startsAt.getTime(),dayStart.getTime()))/60000,0),activeTasks:tasks.find(t=>t.assigneeId===user.id)?._count??0};
  });
  rankCandidates(candidates);
  return {orderVersion:order.version,currentBookingId:current?.id??null,startsAt:start.toISOString(),endsAt:end.toISOString(),recommendedId:candidates.find(c=>c.eligible)?.id??null,candidates};
 }
 recommend(actor:Actor,id:string,slot:AssignmentSlot){return serializable(this.db.client,tx=>this.plan(tx,actor,id,slot));}
 async assign(actor:Actor,id:string,input:AssignOrderInput){
  const {idempotencyKey,...payload}=input,inputHash=digest(JSON.stringify({orderId:id,...payload}));
  try{return await serializable(this.db.client,async tx=>{
   await this.owner(tx,actor);
   const saved=await tx.workBooking.findUnique({where:{organizationId_idempotencyKey:{organizationId:actor.organizationId,idempotencyKey}}});
   if(saved){if(saved.inputHash!==inputHash||saved.createdById!==actor.id)throw new ConflictException('Ключ операции уже использован');return tx.workBooking.findUniqueOrThrow({where:{id:saved.id},select:bookingSelect});}
   const plan=await this.plan(tx,actor,id,input);
   if(plan.orderVersion!==input.orderVersion||plan.currentBookingId!==input.currentBookingId)throw stale();
   const candidate=plan.candidates.find(c=>c.id===input.employeeId);
   if(!candidate)throw new NotFoundException('Сотрудник не найден');
   if(!candidate.eligible||candidate.profileVersion!==input.profileVersion)throw stale();
   if(plan.currentBookingId){const previous=await tx.workBooking.findUniqueOrThrow({where:{id:plan.currentBookingId}});await releaseBooking(tx,this.audit,actor,previous);}
   const order=await tx.order.findUniqueOrThrow({where:{id}});
   const task=await tx.businessTask.create({data:{organizationId:actor.organizationId,createdById:actor.id,assigneeId:input.employeeId,orderId:id,title:order.title.slice(0,200),dueDate:new Date(almatyTime(new Date(plan.startsAt)).day+'T00:00:00Z')}});
   const booking=await tx.workBooking.create({data:{organizationId:actor.organizationId,orderId:id,employeeId:input.employeeId,taskId:task.id,startsAt:new Date(plan.startsAt),endsAt:new Date(plan.endsAt),requiredSkills:input.requiredSkills,createdById:actor.id,idempotencyKey,inputHash},select:bookingSelect});
   await tx.order.update({where:{id},data:{version:{increment:1},plannedMinutes:order.plannedMinutes??input.durationMinutes}});
   await this.audit.record(tx,actor,'TASK',task.id,'TASK_CREATED',{title:task.title});
   await this.audit.record(tx,actor,'ORDER',id,'ORDER_ASSIGNED',{number:order.number,employee:candidate.name,startsAt:plan.startsAt,endsAt:plan.endsAt,requiredSkills:input.requiredSkills,profileVersion:input.profileVersion,workloadMinutes:candidate.workloadMinutes,activeTasks:candidate.activeTasks,recommended:plan.recommendedId===candidate.id});
   await publishTaskNotification(tx,{organizationId:actor.organizationId,taskId:task.id,actorId:actor.id,actorName:actor.name,kind:'TASK_ASSIGNED',eventKey:'schedule:'+booking.id+':assigned'});
   return booking;
  });}catch(error){
   const conflict=(e:unknown,depth=0):boolean=>depth<6&&!!e&&typeof e==='object'&&(Object.entries(e).some(([k,v])=>(['code','originalCode'].includes(k)&&v==='23P01')||(typeof v==='string'&&v.includes('WorkBooking_no_overlap'))||(typeof v==='object'&&conflict(v,depth+1))));
   if(conflict(error)||(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2004'))throw stale();throw error;
  }
 }
 cancel(actor:Actor,id:string,bookingId:string){return serializable(this.db.client,async tx=>{
  await this.order(tx,actor,id);
  const booking=await tx.workBooking.findFirst({where:{id:bookingId,orderId:id,organizationId:actor.organizationId}});
  if(!booking)throw new NotFoundException('Назначение не найдено');
  if(!booking.releasedAt){await releaseBooking(tx,this.audit,actor,booking);await tx.order.update({where:{id},data:{version:{increment:1}}});}
  return {ok:true};
 });}
}
