import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mailConfig } from './mail-config';

export const localNotificationMailbox=resolve(__dirname,'../../../../.local/mail/notifications');
export type OutgoingMail={id:string;to:string;subject:string;text:string};
@Injectable()
export class MailTransport {
  readonly config=mailConfig();
  readonly mode=this.config.mode;
  private readonly smtp=this.mode==='gmail'?nodemailer.createTransport({
    host:'smtp.gmail.com',port:465,secure:true,auth:{user:this.config.user,pass:this.config.password},
    tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,
    logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,
  }):null;
  async send(message:OutgoingMail){
    if(this.mode==='disabled')throw new Error('Mail delivery is disabled');
    if(this.smtp){
      const result=await this.smtp.sendMail({from:{name:'TirekCRM',address:this.config.user},to:message.to,subject:message.subject,text:message.text,messageId:`<${message.id}@tirek.local>`});
      if(!result.accepted?.length)throw new Error('Mail was not accepted');
      return;
    }
    await mkdir(localNotificationMailbox,{recursive:true,mode:0o700});
    const file=join(localNotificationMailbox,message.id+'.json'),temporary=file+'.'+randomUUID()+'.tmp';
    try{await writeFile(temporary,JSON.stringify(message,null,2),{flag:'wx',mode:0o600});await rename(temporary,file);}
    finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
}
