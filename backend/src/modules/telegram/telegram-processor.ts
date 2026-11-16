import {Injectable,HttpException,NotFoundException} from '@nestjs/common';
import type {QuoteSnapshot} from '@tirek/contracts';
import {z} from 'zod';
import {Database} from '../../database/database.service';
import {PassportService} from '../smart-orders/passport.service';
import {TelegramService} from './telegram.service';
import {TelegramTransport,TelegramTransportError} from './telegram-transport';
import {compressTelegramPhoto,photoKey} from './telegram-photo';
import {tgText,tgDate} from './telegram-text';
import {TasksService} from '../tasks/tasks.service';
import {parseTaskAction} from './telegram-actions';
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sender=z.object({id,is_bot:z.boolean().optional(),first_name:z.string().max(256).optional(),last_name:z.string().max(256).optional(),username:z.string().regex(/^[A-Za-z0-9_]{1,32}$/).optional(),language_code:z.string().max(20).optional()});
const message=z.object({message_id:id,date:z.number().int().nonnegative().optional(),chat:z.object({id:z.number().int().safe(),type:z.string()}),from:sender.optional(),text:z.string().max(4096).optional(),photo:z.array(z.object({file_id:z.string().min(1).max(1024),file_size:z.number().int().positive().optional(),width:z.number().int().positive(),height:z.number().int().positive()})).max(10).optional()});
export const telegramUpdateSchema=z.object({update_id:id,message:message.optional(),callback_query:z.object({id:z.string().max(256),from:sender,message:message.optional(),data:z.string().max(64).optional()}).optional()});
@Injectable()
export class TelegramProcessor {
 private readonly budgets=new Map<string,{at:number;count:number}>();
 constructor(private readonly db:Database,private readonly service:TelegramService,private readonly transport:TelegramTransport,private readonly passports:PassportService,private readonly tasks:TasksService){}
 private allowed(sender:string){const now=Date.now(),old=this.budgets.get(sender);if(!old||old.at<now-60000){if(this.budgets.size>=10000)this.budgets.clear();this.budgets.set(sender,{at:now,count:1});return true;}return ++old.count<=20;}
 async card(linkId:string,taskId:string,assigned=false){
  const {link,task}=await this.service.task(linkId,taskId,!assigned),locale=link.locale,active=task.status==='TODO'||task.status==='IN_PROGRESS';
  let text=(assigned?tgText(locale,'assigned')+'\n':'')+task.title+'\n'+tgText(locale,task.status==='TODO'?'todo':task.status==='IN_PROGRESS'?'inProgress':task.status==='DONE'?'done':'cancelledTask');
  if(task.booking&&!task.booking.releasedAt)text+='\n'+tgDate(task.booking.startsAt,locale)+' — '+tgDate(task.booking.endsAt,locale)+' (Алматы)';
  else if(task.dueDate)text+='\n'+new Intl.DateTimeFormat(locale==='kk'?'kk-KZ':locale==='en'?'en-GB':'ru-KZ',{timeZone:'Asia/Almaty',day:'numeric',month:'short'}).format(task.dueDate);
  if(task.description)text+='\n\n'+task.description.slice(0,1500);
  if(task.status==='IN_PROGRESS'&&task.orderId)text+='\n\n'+tgText(locale,'photoBeforeDone');
  return this.transport.send(link.telegramUserId,text,[...(active?[[{text:tgText(locale,task.status==='TODO'?'startWork':'finishTask'),callback_data:(task.status==='TODO'?'start:':'done:')+task.id+':'+task.version}]]:[]),...(active&&task.orderId?[[{text:tgText(locale,'photo'),callback_data:'photo:'+task.id}]]:[]),[{text:tgText(locale,'tasks'),callback_data:'list:1'}]]);
 }
 async quoteApproved(linkId:string,taskId:string,quoteId:string){
  const {link,task}=await this.service.task(linkId,taskId);
  if(!task.orderId)throw new NotFoundException('Задача не найдена');
  const quote=await this.db.client.orderQuote.findFirst({
   where:{id:quoteId,orderId:task.orderId,organizationId:link.organizationId,acceptedAt:{not:null},
    order:{status:{in:['NEW','CONFIRMED','IN_PROGRESS']}}},
   select:{kind:true,snapshot:true,order:{select:{number:true}}},
  });
  if(!quote)throw new NotFoundException('Задача не найдена');
  const key=quote.kind==='EXTRA'?'extraApproved':'baseApproved';
  let text=tgText(link.locale,key)+' · '+tgText(link.locale,'orderNo')+' '+quote.order.number;
  if(quote.kind==='EXTRA'){
   const snapshot=quote.snapshot as unknown as QuoteSnapshot;
   const lines=snapshot.items.map(item=>'• '+item.quantity+' × '+item.description);
   text+='\n\n'+lines.join('\n');
  }
  return this.transport.send(link.telegramUserId,text,[[{text:tgText(link.locale,'open'),callback_data:'task:'+task.id}]]);
 }
 async handle(raw:unknown){
  try{return await this.process(raw);}catch(error){
   if(error instanceof TelegramTransportError&&error.code===403){const v=telegramUpdateSchema.safeParse(raw);if(v.success){const from=v.data.callback_query?.from??v.data.message?.from;if(from)await this.service.stop(this.transport.config.botId,String(from.id));}return;}throw error;
  }
 }
 private async process(raw:unknown){
  const parsed=telegramUpdateSchema.safeParse(raw);if(!parsed.success)return;
  const update=parsed.data,callback=update.callback_query,msg=callback?.message??update.message,from=callback?.from??msg?.from;
  if(!msg||!from||from.is_bot||msg.chat.type!=='private'||msg.chat.id!==from.id)return;
  const senderId=String(from.id),botId=this.transport.config.botId;
  if(!this.allowed(senderId))return;
  if(callback){try{await this.transport.call('answerCallbackQuery',{callback_query_id:callback.id});}catch(error){if(!(error instanceof TelegramTransportError&&error.code===400))throw error;}}
  const initialLocale=from.language_code?.startsWith('kk')?'kk':from.language_code?.startsWith('en')?'en':'ru';
  const text=update.message?.text?.trim()??'',command=text.split(/\s/)[0].split('@')[0];
  if(command==='/stop'){await this.service.stop(botId,senderId);await this.transport.send(senderId,tgText(initialLocale,'stopped'));return;}
  if(command==='/start'&&/^\/start(?:@[A-Za-z0-9_]+)?\s+[a-f0-9]{64}$/.test(text)){
   const accepted=await this.service.claim(botId,text.split(/\s+/)[1],{id:senderId,name:[from.first_name,from.last_name].filter(Boolean).join(' ').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,160),username:from.username??''});
   await this.transport.send(senderId,tgText(initialLocale,accepted?'confirm':'invalid'));return;
  }
  const link=await this.service.binding(botId,senderId);
  if(!link){await this.transport.send(senderId,tgText(initialLocale,'connect'));return;}
  const locale=link.locale;
  try{
   const data=callback?.data??'';
   const action=parseTaskAction(data);
   if(action){
    try{await this.tasks.status(link.user,action.taskId,action.status,action.version,{linkId:link.id,botId,telegramUserId:senderId});}
    catch(error){if(error instanceof HttpException&&error.getStatus()===409){await this.transport.send(senderId,tgText(locale,'staleAction'),[[{text:tgText(locale,'tasks'),callback_data:'list:1'}]]);return;}throw error;}
    await this.card(link.id,action.taskId);return;
   }
   if(command==='/cancel'){await this.db.client.telegramLink.updateMany({where:{id:link.id},data:{selectedAt:null,selectedTaskId:null}});await this.transport.send(senderId,tgText(locale,'cancelled'));return;}
   if(command==='/tasks'||command==='/start'||/^list:[1-9]\d{0,3}$/.test(data)){
    const page=data.startsWith('list:')?Number(data.slice(5)):1,result=await this.service.list(link.id,page);
    const buttons=result.tasks.map(task=>[{text:task.title.slice(0,60),callback_data:'task:'+task.id}]);
    if(page>1)buttons.push([{text:tgText(locale,'back'),callback_data:'list:'+(page-1)}]);if(page*5<result.total)buttons.push([{text:tgText(locale,'next'),callback_data:'list:'+(page+1)}]);
    await this.transport.send(senderId,tgText(locale,result.tasks.length?'tasks':'empty'),buttons);return;
   }
   if(/^(?:task|photo):[a-f0-9-]{36}$/.test(data)){
    const taskId=data.split(':')[1];if(!z.uuid().safeParse(taskId).success)return;
    if(data.startsWith('task:')){await this.card(link.id,taskId);return;}
    const current=await this.service.task(link.id,taskId,true);
    if(!['TODO','IN_PROGRESS'].includes(current.task.status)){await this.transport.send(senderId,tgText(locale,'closedPhoto'),[[{text:tgText(locale,'tasks'),callback_data:'list:1'}]]);return;}
    await this.service.selectPhoto(link.id,taskId);await this.transport.send(senderId,tgText(locale,'select'));return;
   }
   if(update.message?.photo?.length){
    if(!link.selectedTaskId||!link.selectedAt||link.selectedAt.getTime()<Date.now()-900000||!msg.date||msg.date<Math.floor(Math.max(link.createdAt.getTime(),link.selectedAt.getTime())/1000)||msg.date*1000>Date.now()+60000){await this.transport.send(senderId,tgText(locale,'noSelection'));return;}
    const {task}=await this.service.task(link.id,link.selectedTaskId,true);if(!['TODO','IN_PROGRESS'].includes(task.status)){await this.transport.send(senderId,tgText(locale,'closedPhoto'));return;}if(!task.orderId){await this.transport.send(senderId,tgText(locale,'unavailable'));return;}
    const size=[...update.message.photo].filter(p=>!p.file_size||p.file_size<=5_000_000).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    if(!size){await this.transport.send(senderId,tgText(locale,'badPhoto'));return;}
    let image:string;
    try{image=await compressTelegramPhoto(await this.transport.photo(size.file_id));}catch{await this.transport.send(senderId,tgText(locale,'badPhoto'));return;}
    await this.passports.photo(link.user,task.orderId,{image,phase:'AFTER',shared:false,idempotencyKey:photoKey(botId,senderId,msg.message_id)},{linkId:link.id,taskId:task.id});
    await this.transport.send(senderId,tgText(locale,'saved'));return;
   }
   await this.transport.send(senderId,tgText(locale,'help'));
  }catch(error){if(error instanceof HttpException&&error.getStatus()<500){await this.transport.send(senderId,tgText(locale,update.message?.photo?'badPhoto':'unavailable'));return;}throw error;}
 }
}
