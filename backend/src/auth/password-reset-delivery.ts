import { Injectable } from '@nestjs/common';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { webOrigin } from '../common/web-origin';
import { Database } from '../database/database.service';
import { MailQueue } from '../modules/mail/mail-queue';
import { mailConfig } from '../modules/mail/mail-config';

export function passwordResetDeliveryMode(env:NodeJS.ProcessEnv=process.env):'local'|'disabled'|'gmail' {
  const mode=env.PASSWORD_RESET_DELIVERY??mailConfig(env).mode;
  if(!['local','disabled','gmail'].includes(mode))throw new Error('Unsupported PASSWORD_RESET_DELIVERY');
  if(mode==='local'&&env.NODE_ENV==='production')throw new Error('Local password-reset delivery must not run in production');
  if(mode==='gmail'&&mailConfig(env).mode!=='gmail')throw new Error('Configure Gmail mail delivery before password recovery');
  return mode as 'local'|'disabled'|'gmail';
}
export const localResetMailbox=resolve(__dirname,'../../../.local/mail/password-reset');
export type ResetMessage={userId:string;organizationId:string;to:string;token:string;expiresAt:Date};
@Injectable()
export class PasswordResetDelivery {
  readonly mode=passwordResetDeliveryMode();
  readonly enabled=this.mode!=='disabled';
  constructor(private readonly db:Database,private readonly mail:MailQueue){}
  async send(message:ResetMessage){
    if(!this.enabled)throw new Error('Password reset delivery is disabled');
    if(this.mode==='gmail'){
      await this.db.client.$transaction(tx=>this.mail.reset(tx,{id:message.userId,organizationId:message.organizationId,email:message.to},message.token,message.expiresAt));
      return;
    }
    await mkdir(localResetMailbox,{recursive:true,mode:0o700});
    const id=randomUUID(),temporary=join(localResetMailbox,id+'.tmp'),file=join(localResetMailbox,id+'.json');
    try{
      // Local development only. Never put the bearer token into logs or HTTP responses.
      await writeFile(temporary,JSON.stringify({to:message.to,subject:'Tirek: восстановление пароля',token:message.token,expiresAt:message.expiresAt.toISOString(),confirmationEndpoint:webOrigin()+'/api/auth/password-reset/confirm',resetUrl:webOrigin()+'/reset-password#token='+message.token},null,2),{flag:'wx',mode:0o600});
      await rename(temporary,file);
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
}
