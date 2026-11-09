import {Injectable,ForbiddenException,ConflictException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {randomBytes,randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {digest} from '../../auth/session.guard';
import {AuditService,type Actor} from '../audit/audit.service';
import {TelegramTransport} from './telegram-transport';
export type TelegramLocale='ru'|'kk'|'en';
const linkSelect={id:true,displayName:true,username:true,locale:true} as const;
@Injectable()
export class TelegramService {
 constructor(private readonly db:Database,private readonly transport:TelegramTransport,private readonly audit:AuditService){}
 private async employee(tx:Prisma.TransactionClient,actor:Actor){
  if(!await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,role:'EMPLOYEE',isActive:true}}))throw new ForbiddenException('Подключение Telegram доступно в аккаунте сотрудника');
 }
 private enabled(){if(!this.transport.config.enabled)throw new ServiceUnavailableException('Telegram-бот пока не настроен');}
 async status(actor:Actor){
  const user=await this.db.client.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true}});
  if(!user)throw new ForbiddenException('Недостаточно прав');
  const bot=this.transport.config.enabled?await this.transport.me().catch(()=>null):null;
  const link=await this.db.client.telegramLink.findUnique({where:{userId:actor.id},select:{...linkSelect,botId:true}}),pending=await this.db.client.telegramPairing.findUnique({where:{userId:actor.id}});
  return {enabled:!!bot,botUsername:bot?.username??null,eligible:user.role==='EMPLOYEE',linked:link?.botId===this.transport.config.botId?{id:link.id,displayName:link.displayName,username:link.username,locale:link.locale}:null,
   pending:pending&&pending.botId===this.transport.config.botId&&pending.expiresAt>new Date()?{id:pending.id,expiresAt:pending.expiresAt,displayName:pending.displayName,username:pending.username,claimed:!!pending.telegramUserId}:null};
 }
 async pair(actor:Actor,locale:TelegramLocale){
  this.enabled();const bot=await this.transport.me(),token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+600000);
  const pending=await serializable(this.db.client,async tx=>{
   await this.employee(tx,actor);
   if(await tx.telegramLink.findUnique({where:{userId:actor.id}}))throw new ConflictException('Сначала отключите прежнее подключение Telegram');
   return tx.telegramPairing.upsert({where:{userId:actor.id},create:{userId:actor.id,organizationId:actor.organizationId,botId:String(bot.id),tokenHash:digest(token),expiresAt},update:{id:randomUUID(),botId:String(bot.id),tokenHash:digest(token),expiresAt,telegramUserId:null,displayName:'',username:''}});
  });
  return {id:pending.id,url:'https://t.me/'+bot.username+'?start='+token,expiresAt,locale};
 }
 async claim(botId:string,token:string,sender:{id:string;name:string;username:string}){
  return serializable(this.db.client,async tx=>{
   const pending=await tx.telegramPairing.findUnique({where:{tokenHash:digest(token)},include:{user:true}});
   if(!pending||pending.botId!==botId||pending.expiresAt<=new Date()||!pending.user.isActive||pending.user.role!=='EMPLOYEE')return false;
   if(pending.telegramUserId&&pending.telegramUserId!==sender.id)return false;
   if(await tx.telegramLink.findUnique({where:{botId_telegramUserId:{botId,telegramUserId:sender.id}}}))return false;
   await tx.telegramPairing.update({where:{id:pending.id},data:{telegramUserId:sender.id,displayName:sender.name.replace(/[\u0000-\u001f\u007f\ud800-\udfff]/gu,'').slice(0,160).replace(/[\ud800-\udbff]$/,''),username:sender.username.slice(0,32)}});return true;
  });
 }
 async confirm(actor:Actor,id:string,locale:TelegramLocale){
  this.enabled();
  return serializable(this.db.client,async tx=>{
   await this.employee(tx,actor);
   const pending=await tx.telegramPairing.findFirst({where:{id,userId:actor.id,organizationId:actor.organizationId,botId:this.transport.config.botId,expiresAt:{gt:new Date()}}});
   if(!pending?.telegramUserId)throw new ConflictException('Откройте бота по ссылке и обновите состояние');
   if(await tx.telegramLink.findUnique({where:{botId_telegramUserId:{botId:pending.botId,telegramUserId:pending.telegramUserId}}}))throw new ConflictException('Этот Telegram уже подключён. Сначала отключите прежнюю привязку');
   const link=await tx.telegramLink.create({data:{userId:actor.id,organizationId:actor.organizationId,botId:pending.botId,telegramUserId:pending.telegramUserId,displayName:pending.displayName,username:pending.username,locale,createdAt:new Date()},select:linkSelect});
   await tx.telegramPairing.delete({where:{id}});await this.audit.record(tx,actor,'ACCOUNT',actor.id,'TELEGRAM_CONNECTED',{});return link;
  });
 }
 disconnect(actor:Actor){return serializable(this.db.client,async tx=>{
  if(!await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true}}))throw new ForbiddenException('Недостаточно прав');
  await tx.telegramPairing.deleteMany({where:{userId:actor.id,organizationId:actor.organizationId}});
  const r=await tx.telegramLink.deleteMany({where:{userId:actor.id,organizationId:actor.organizationId}});
  if(r.count)await this.audit.record(tx,actor,'ACCOUNT',actor.id,'TELEGRAM_DISCONNECTED',{});return {ok:true};
 });}
 async binding(botId:string,senderId:string){return this.db.client.telegramLink.findFirst({where:{botId,telegramUserId:senderId,user:{isActive:true,role:'EMPLOYEE'}},include:{user:true}});}
 stop(botId:string,senderId:string){return serializable(this.db.client,async tx=>{
  const link=await tx.telegramLink.findUnique({where:{botId_telegramUserId:{botId,telegramUserId:senderId}},include:{user:true}});
  if(link){await tx.telegramLink.delete({where:{id:link.id}});await tx.telegramPairing.deleteMany({where:{userId:link.userId}});await this.audit.record(tx,link.user,'ACCOUNT',link.userId,'TELEGRAM_DISCONNECTED',{});}return {ok:true};
 });}
 async task(linkId:string,id:string,includeClosed=false){
  const link=await this.db.client.telegramLink.findFirst({where:{id:linkId,user:{isActive:true,role:'EMPLOYEE'}}});
  if(!link)throw new ForbiddenException('Подключение Telegram отключено');
  const task=await this.db.client.businessTask.findFirst({where:{id,organizationId:link.organizationId,assigneeId:link.userId,...(!includeClosed?{status:{in:['TODO','IN_PROGRESS'] as ('TODO'|'IN_PROGRESS')[]}}:{})},select:{id:true,title:true,description:true,status:true,version:true,dueDate:true,orderId:true,booking:{select:{startsAt:true,endsAt:true,releasedAt:true}}}});
  if(!task)throw new NotFoundException('Задача больше не назначена вам');return {link,task};
 }
 async list(linkId:string,page:number){
  const link=await this.db.client.telegramLink.findFirst({where:{id:linkId,user:{isActive:true,role:'EMPLOYEE'}}});
  if(!link)throw new ForbiddenException('Подключение Telegram отключено');
  const where={organizationId:link.organizationId,assigneeId:link.userId,status:{in:['TODO','IN_PROGRESS'] as ('TODO'|'IN_PROGRESS')[]}};
  const [tasks,total]=await this.db.client.$transaction([this.db.client.businessTask.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*5,take:5,select:{id:true,title:true}}),this.db.client.businessTask.count({where})]);
  return {tasks,total};
 }
 async selectPhoto(linkId:string,taskId:string){
  return serializable(this.db.client,async tx=>{
   const link=await tx.telegramLink.findFirst({where:{id:linkId,user:{isActive:true,role:'EMPLOYEE'}}});
   if(!link)throw new ForbiddenException('Подключение Telegram отключено');
   const task=await tx.businessTask.findFirst({where:{id:taskId,organizationId:link.organizationId,assigneeId:link.userId,status:{in:['TODO','IN_PROGRESS']},orderId:{not:null}}});
   if(!task)throw new NotFoundException('Для фото нужна активная задача, связанная с заказом');
   await tx.telegramLink.update({where:{id:linkId},data:{selectedTaskId:taskId,selectedAt:new Date()}});return task;
  });
 }
}
