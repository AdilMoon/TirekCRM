import { Injectable,ForbiddenException,UnauthorizedException,NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Database } from '../database/database.service';
import { AuditService,Actor } from '../modules/audit/audit.service';
import { serializable } from '../common/transaction';
import { createSession } from './session';
import { hashPassword,verifyPassword } from './session.guard';

const sessionSelect={id:true,tokenHash:true,createdAt:true,expiresAt:true,userAgent:true} as const;
export const cleanUserAgent=(value:string|undefined)=>(value??'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,300);
@Injectable()
export class AuthService {
 private readonly dummyHash=hashPassword(randomBytes(32).toString('hex'));
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 private async current(tx:Prisma.TransactionClient,actor:Actor,tokenHash:string){
  const session=await tx.session.findFirst({where:{tokenHash,userId:actor.id,expiresAt:{gt:new Date()},user:{isActive:true,organizationId:actor.organizationId}}});
  if(!session)throw new UnauthorizedException('Сессия истекла. Войдите снова');
  return session;
 }
 async login(email:string,password:string,userAgent:string){
  const snapshot=await this.db.client.user.findUnique({where:{email:email.toLowerCase().trim()}});
  const valid=await verifyPassword(password,snapshot?.passwordHash??await this.dummyHash);
  if(!snapshot||!snapshot.isActive||!valid)throw new UnauthorizedException('Неверный email или пароль');
  return serializable(this.db.client,async tx=>{
   // Recheck credentials inside the transaction: an in-flight old-password login must not survive a password change.
   const user=await tx.user.findUnique({where:{id:snapshot.id}});
   if(!user?.isActive||user.passwordHash!==snapshot.passwordHash)throw new UnauthorizedException('Неверный email или пароль');
   await tx.session.deleteMany({where:{userId:user.id,expiresAt:{lte:new Date()}}});
   const overflow=await tx.session.findMany({where:{userId:user.id},orderBy:[{createdAt:{sort:'desc',nulls:'last'}},{id:'desc'}],skip:19,select:{id:true}});
   if(overflow.length)await tx.session.deleteMany({where:{userId:user.id,id:{in:overflow.map(s=>s.id)}}});
   return createSession(tx,user.id,userAgent);
  });
 }
 async sessions(actor:Actor,tokenHash:string){
  const sessions=await this.db.client.session.findMany({where:{userId:actor.id,expiresAt:{gt:new Date()}},select:sessionSelect,orderBy:[{createdAt:{sort:'desc',nulls:'last'}},{id:'desc'}]});
  return sessions.map(({tokenHash:stored,...session})=>({...session,current:stored===tokenHash}));
 }
 async changePassword(actor:Actor,tokenHash:string,currentPassword:string,newPassword:string,userAgent:string){
  const previous=await this.db.client.user.findUnique({where:{id:actor.id}});
  if(!previous||!await verifyPassword(currentPassword,previous.passwordHash))throw new ForbiddenException('Текущий пароль неверен');
  if(currentPassword===newPassword)throw new ForbiddenException('Новый пароль должен отличаться от текущего');
  const passwordHash=await hashPassword(newPassword);
  return serializable(this.db.client,async tx=>{
   await this.current(tx,actor,tokenHash);
   const user=await tx.user.findUniqueOrThrow({where:{id:actor.id}});
   if(user.passwordHash!==previous.passwordHash)throw new UnauthorizedException('Сессия истекла. Войдите снова');
   await tx.user.update({where:{id:actor.id},data:{passwordHash}});
   await tx.session.deleteMany({where:{userId:actor.id}});
   const session=await createSession(tx,actor.id,userAgent);
   await this.audit.record(tx,actor,'ACCOUNT',actor.id,'PASSWORD_CHANGED');
   return session;
  });
 }
 revokeOthers(actor:Actor,tokenHash:string){
  return serializable(this.db.client,async tx=>{
   await this.current(tx,actor,tokenHash);
   const {count}=await tx.session.deleteMany({where:{userId:actor.id,tokenHash:{not:tokenHash},expiresAt:{gt:new Date()}}});
   if(count)await this.audit.record(tx,actor,'ACCOUNT',actor.id,'OTHER_SESSIONS_REVOKED',{count});
   return {count};
  });
 }
 revoke(actor:Actor,tokenHash:string,id:string){
  return serializable(this.db.client,async tx=>{
   await this.current(tx,actor,tokenHash);
   const target=await tx.session.findFirst({where:{id,userId:actor.id,expiresAt:{gt:new Date()}}});
   if(!target)throw new NotFoundException('Сеанс не найден');
   await tx.session.delete({where:{id}});
   await this.audit.record(tx,actor,'ACCOUNT',actor.id,'SESSION_REVOKED');
   return {current:target.tokenHash===tokenHash};
  });
 }
}
