import {Injectable,Logger,OnModuleInit,OnModuleDestroy,HttpException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Database} from '../../database/database.service';
import {TelegramTransport,TelegramTransportError} from './telegram-transport';
import {TelegramService} from './telegram.service';
import {TelegramProcessor} from './telegram-processor';
@Injectable()
export class TelegramWorker implements OnModuleInit,OnModuleDestroy {
 private readonly logger=new Logger('Telegram');
 private timer?:NodeJS.Timeout;private running:Promise<number>|null=null;private stopped=false;private readonly abort=new AbortController();private ready=false;private nextTick=0;
 constructor(private readonly db:Database,private readonly transport:TelegramTransport,private readonly processor:TelegramProcessor,private readonly service:TelegramService){}
 onModuleInit(){if(!this.transport.config.enabled)return;const tick=()=>{if(Date.now()<this.nextTick)return;void this.runOnce().catch(error=>{this.nextTick=Date.now()+Math.max(5000,error instanceof TelegramTransportError?error.retryAfter*1000:0);if(!this.stopped)this.logger.warn('TELEGRAM_WORKER_RETRY');});};this.timer=setInterval(tick,1000);this.timer.unref();tick();}
 async onModuleDestroy(){this.stopped=true;this.abort.abort();if(this.timer)clearInterval(this.timer);await this.running?.catch(()=>{});}
 runOnce(){if(this.running)return this.running;this.running=this.poll().finally(()=>{this.running=null;});return this.running;}
 private async poll(){
  if(!this.transport.config.enabled||this.stopped)return 0;
  const botId=this.transport.config.botId;
  if(!this.ready){await this.transport.me();const webhook=await this.transport.call<{url:string}>('getWebhookInfo',{});if(webhook.url)throw new TelegramTransportError(409);this.ready=true;this.logger.log('TELEGRAM_POLLING_READY');}
  await this.db.client.telegramBotState.upsert({where:{botId},create:{botId},update:{}});
  const leaseToken=randomUUID(),claimed=await this.db.client.telegramBotState.updateMany({where:{botId,OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{leaseToken,leaseUntil:new Date(Date.now()+90000)}});
  if(!claimed.count)return 0;
  let count=0;
  const renew=async()=>{if(this.stopped)return false;return (await this.db.client.telegramBotState.updateMany({where:{botId,leaseToken},data:{leaseUntil:new Date(Date.now()+90000)}})).count===1;};
  try{
   for(let i=0;i<5&&await renew();i++){
    const delivery=await this.db.client.telegramDelivery.findFirst({where:{status:'PENDING',nextAttemptAt:{lte:new Date()},link:{botId}},orderBy:[{createdAt:'asc'},{id:'asc'}],include:{link:true,notification:true}});if(!delivery)break;
    try{
     if(delivery.notification.recipientId!==delivery.link.userId||delivery.notification.kind!=='TASK_ASSIGNED')throw new HttpException('SKIP',404);
     await this.db.client.telegramDelivery.update({where:{id:delivery.id},data:{attempts:{increment:1}}});
     const sent=await this.processor.card(delivery.linkId,delivery.notification.taskId,true);
     await this.db.client.telegramDelivery.updateMany({where:{id:delivery.id},data:{status:'SENT',sentAt:new Date(),messageId:String(sent.message_id)}});count++;
    }catch(error){
     if(error instanceof TelegramTransportError&&error.code===403){await this.service.stop(botId,delivery.link.telegramUserId);continue;}
     const skip=error instanceof HttpException&&error.getStatus()<500,failed=delivery.attempts+1>=6;
     await this.db.client.telegramDelivery.updateMany({where:{id:delivery.id},data:{status:skip?'SKIPPED':failed?'FAILED':'PENDING',nextAttemptAt:new Date(Date.now()+Math.max(30000*2**delivery.attempts,error instanceof TelegramTransportError?error.retryAfter*1000:0))}});
    }
   }
   if(!await renew())return count;
   const state=await this.db.client.telegramBotState.findUniqueOrThrow({where:{botId}}),stale=!!state.lastPollAt&&state.lastPollAt.getTime()<Date.now()-6*86400000;
   const updates=await this.transport.call<unknown[]>('getUpdates',{...(!stale?{offset:Number(state.nextUpdateId)}:{}),timeout:10,limit:10,allowed_updates:['message','callback_query']},this.abort.signal);
   if(!Array.isArray(updates))throw new TelegramTransportError(0);
   let offset=stale?0:Number(state.nextUpdateId);
   updates.sort((a,b)=>Number((a as {update_id?:number})?.update_id??0)-Number((b as {update_id?:number})?.update_id??0));
   for(const update of updates){
    if(!await renew())break;
    const id=(update as {update_id?:unknown})?.update_id;if(typeof id!=='number'||!Number.isSafeInteger(id)||id<1||id>=Number.MAX_SAFE_INTEGER)continue;
    if(!await this.db.client.telegramUpdateReceipt.findUnique({where:{botId_updateId:{botId,updateId:BigInt(id)}}})){
     try{await this.processor.handle(update);}catch(error){if(!(error instanceof TelegramTransportError&&error.code===400))throw error;this.logger.warn('TELEGRAM_UPDATE_REJECTED');}
    }
    offset=Math.max(offset,id+1);
    await this.db.client.$transaction(async tx=>{
     const changed=await tx.telegramBotState.updateMany({where:{botId,leaseToken},data:{nextUpdateId:BigInt(offset),lastPollAt:new Date()}});if(!changed.count)throw Error('LEASE_LOST');
     await tx.telegramUpdateReceipt.upsert({where:{botId_updateId:{botId,updateId:BigInt(id)}},create:{botId,updateId:BigInt(id),createdAt:new Date()},update:{}});
    });count++;
   }
   await this.db.client.telegramBotState.updateMany({where:{botId,leaseToken},data:{lastPollAt:new Date()}});
   await this.db.client.telegramUpdateReceipt.deleteMany({where:{botId,createdAt:{lt:new Date(Date.now()-30*86400000)}}});
   return count;
  }finally{await this.db.client.telegramBotState.updateMany({where:{botId,leaseToken},data:{leaseToken:null,leaseUntil:null}});}
 }
}
