import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database } from '../../database/database.service';
import { webOrigin } from '../../common/web-origin';
import { digest } from '../../auth/session.guard';
import { decryptReset } from './mail-queue';
import { MailTransport } from './mail-transport';

@Injectable()
export class MailWorker implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger('Mail');
  private timer?:NodeJS.Timeout;
  private running:Promise<number>|null=null;
  constructor(private readonly db:Database,private readonly transport:MailTransport){}
  onModuleInit(){if(this.transport.mode==='disabled')return;const tick=()=>void this.runOnce().catch(()=>this.logger.error('MAIL_WORKER_FAILED'));this.timer=setInterval(tick,5000);this.timer.unref();tick();}
  async onModuleDestroy(){if(this.timer)clearInterval(this.timer);await this.running;}
  runOnce(){if(this.running)return this.running;this.running=this.drain().finally(()=>{this.running=null;});return this.running;}
  private async drain(){
    if(this.transport.mode==='disabled')return 0;
    let count=0;
    for(let i=0;i<10;i++){
      const now=new Date(),ready={deliveryMode:this.transport.mode,status:'PENDING',nextAttemptAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]};
      const row=await this.db.client.mailMessage.findFirst({where:ready,orderBy:[{createdAt:'asc'},{id:'asc'}]});if(!row)break;
      const leaseToken=randomUUID();
      const claimed=await this.db.client.mailMessage.updateMany({where:{id:row.id,attempts:row.attempts,...ready},data:{leaseToken,leaseUntil:new Date(Date.now()+60000),attempts:{increment:1}}});
      if(!claimed.count)continue;
      const lease={id:row.id,leaseToken};
      try{
        let subject='Tirek: регистрация завершена',text=`Вы зарегистрировались в TirekCRM. Войти в свой аккаунт: ${webOrigin()}`;
        if(row.kind==='PASSWORD_CHANGED'){subject='Tirek: пароль изменён';text=`Пароль вашего аккаунта TirekCRM был изменён. Время события (UTC): ${row.createdAt.toISOString()}. Если это сделали не вы, восстановите доступ и проверьте активные сеансы. Адрес приложения: ${webOrigin()}`;}
        if(row.kind==='PASSWORD_RESET'){
          const token=decryptReset(row.payload??'',row.id,row.userId,this.transport.config.key);
          const reset=await this.db.client.passwordReset.findUnique({where:{userId:row.userId},include:{user:true}});
          if(!row.expiresAt||row.expiresAt<=new Date()||!reset||reset.expiresAt<=new Date()||reset.tokenHash!==digest(token)||!reset.user.isActive||reset.credentialHash!==digest(reset.user.passwordHash)){
            await this.db.client.mailMessage.updateMany({where:lease,data:{status:'SKIPPED',payload:null,leaseToken:null,leaseUntil:null}});continue;
          }
          subject='Tirek: восстановление пароля';text=`Запрошено восстановление пароля TirekCRM. Откройте ссылку и задайте новый пароль: ${webOrigin()}/reset-password#token=${token}\nДействует до ${row.expiresAt.toISOString()}.\nЕсли запрос сделали не вы, ничего не предпринимайте.`;
        }
        await this.transport.send({id:row.id,to:row.recipient,subject,text});
        await this.db.client.mailMessage.updateMany({where:lease,data:{status:'SENT',sentAt:new Date(),payload:null,leaseToken:null,leaseUntil:null,lastErrorCode:null}});count++;
      }catch{
        // Provider errors may contain recipients, credentials or reset tokens.
        this.logger.warn('MAIL_DELIVERY_FAILED');
        const failed=row.attempts+1>=6;
        await this.db.client.mailMessage.updateMany({where:lease,data:{status:failed?'FAILED':'PENDING',...(failed?{payload:null}:{}),nextAttemptAt:new Date(Date.now()+Math.min(3600000,60000*2**row.attempts)),leaseToken:null,leaseUntil:null,lastErrorCode:'DELIVERY_FAILED'}});
      }
    }
    return count;
  }
}
