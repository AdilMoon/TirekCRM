import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { z } from 'zod';
import { mailConfig } from './mail-config';
import { digest } from '../../auth/session.guard';

type Recipient={id:string;organizationId:string;email:string};
export function encryptReset(token:string,id:string,userId:string,key:Buffer){
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(Buffer.from(id+':'+userId));
  const bytes=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return [nonce,cipher.getAuthTag(),bytes].map(value=>value.toString('base64')).join('.');
}
export function decryptReset(payload:string,id:string,userId:string,key:Buffer){
  const [nonce,tag,bytes,...extra]=payload.split('.');
  if(!nonce||!tag||!bytes||extra.length)throw new Error('Invalid encrypted mail');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(nonce,'base64'));
  decipher.setAAD(Buffer.from(id+':'+userId));decipher.setAuthTag(Buffer.from(tag,'base64'));
  const token=Buffer.concat([decipher.update(Buffer.from(bytes,'base64')),decipher.final()]).toString('utf8');
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid reset payload');
  return token;
}
@Injectable()
export class MailQueue {
  async enqueue(tx:Prisma.TransactionClient,user:Recipient,kind:'WELCOME'|'PASSWORD_CHANGED',eventKey=kind+':'+randomUUID()){
    const {mode}=mailConfig();if(mode==='disabled')return;
    z.email().parse(user.email);
    await tx.mailMessage.create({data:{userId:user.id,organizationId:user.organizationId,recipient:user.email,kind,eventKey,deliveryMode:mode}});
  }
  async reset(tx:Prisma.TransactionClient,user:Recipient,token:string,expiresAt:Date){
    const config=mailConfig();if(config.mode!=='gmail')throw new Error('Gmail delivery is not configured');
    z.email().parse(user.email);
    if(!/^[a-f0-9]{64}$/.test(token)||expiresAt<=new Date())throw new Error('Invalid reset mail');
    const id=randomUUID(),payload=encryptReset(token,id,user.id,config.key);
    await tx.mailMessage.create({data:{id,userId:user.id,organizationId:user.organizationId,recipient:user.email,kind:'PASSWORD_RESET',eventKey:'reset:'+digest(token),deliveryMode:'gmail',payload,expiresAt}});
  }
}
