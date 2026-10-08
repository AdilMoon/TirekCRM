import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { InvitationInput } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { AuditService, Actor } from '../audit/audit.service';
import { digest, hashPassword } from '../../auth/session.guard';
import { serializable } from '../../common/transaction';
const memberSelect={id:true,name:true,email:true,role:true,isActive:true,version:true} as const;
const invitationSelect={id:true,name:true,email:true,expiresAt:true,acceptedAt:true,revokedAt:true,createdAt:true} as const;
@Injectable()
export class TeamService {
 constructor(private readonly db:Database,private readonly audit:AuditService) {}
 async list(org:string) {
  const [members,invitations]=await this.db.client.$transaction([
   this.db.client.user.findMany({where:{organizationId:org},select:memberSelect,orderBy:[{name:'asc'},{id:'asc'}]}),
   this.db.client.invitation.findMany({where:{organizationId:org,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}},select:invitationSelect,orderBy:{createdAt:'desc'}}),
  ]);
  return {members,invitations};
 }
 invite(actor:Actor,input:InvitationInput) {
  const token=randomBytes(32).toString('hex');
  return serializable(this.db.client,async tx=>{
   if(await tx.user.findUnique({where:{email:input.email}}))throw new ConflictException('Этот email уже используется');
   if(await tx.invitation.findFirst({where:{organizationId:actor.organizationId,email:input.email,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}}}))throw new ConflictException('Для этого email уже есть активное приглашение');
   const invite=await tx.invitation.create({data:{...input,organizationId:actor.organizationId,invitedById:actor.id,tokenHash:digest(token),expiresAt:new Date(Date.now()+48*3600000)},select:invitationSelect});
   await this.audit.record(tx,actor,'TEAM',invite.id,'INVITATION_CREATED',{name:invite.name});
   return {...invite,token};
  });
 }
 revoke(actor:Actor,id:string) {
  return serializable(this.db.client,async tx=>{
   const invite=await tx.invitation.findFirst({where:{id,organizationId:actor.organizationId}});
   if(!invite)throw new NotFoundException('Приглашение не найдено');
   if(invite.acceptedAt)throw new ConflictException('Приглашение уже принято');
   if(!invite.revokedAt) {
    await tx.invitation.update({where:{id},data:{revokedAt:new Date()}});
    await this.audit.record(tx,actor,'TEAM',id,'INVITATION_REVOKED',{name:invite.name});
   }
   return {ok:true};
  });
 }
 async preview(token:string) {
  const invite=await this.db.client.invitation.findUnique({where:{tokenHash:digest(token)},include:{organization:{select:{name:true}}}});
  if(!invite||invite.acceptedAt||invite.revokedAt||invite.expiresAt<=new Date())throw new NotFoundException('Приглашение недействительно или истекло');
  return {name:invite.name,email:invite.email,organization:invite.organization.name,expiresAt:invite.expiresAt};
 }
 async accept(token:string,password:string) {
  await this.preview(token);
  const passwordHash=await hashPassword(password);
  return serializable(this.db.client,async tx=>{
   const invite=await tx.invitation.findUnique({where:{tokenHash:digest(token)}});
   if(!invite||invite.acceptedAt||invite.revokedAt||invite.expiresAt<=new Date())throw new NotFoundException('Приглашение недействительно или истекло');
   if(await tx.user.findUnique({where:{email:invite.email}}))throw new ConflictException('Этот email уже используется');
   const user=await tx.user.create({data:{email:invite.email,name:invite.name,passwordHash,organizationId:invite.organizationId,role:'EMPLOYEE'}});
   await tx.invitation.update({where:{id:invite.id},data:{acceptedAt:new Date()}});
   await this.audit.record(tx,user,'TEAM',user.id,'MEMBER_JOINED',{name:user.name});
   return {ok:true,email:user.email};
  });
 }
 access(actor:Actor,id:string,input:{isActive:boolean;version:number}) {
  return serializable(this.db.client,async tx=>{
   const member=await tx.user.findFirst({where:{id,organizationId:actor.organizationId}});
   if(!member)throw new NotFoundException('Сотрудник не найден');
   if(member.role==='OWNER')throw new ForbiddenException('Нельзя изменять доступ владельца');
   if(member.version!==input.version)throw new ConflictException('Доступ уже изменён. Обновите список');
   const updated=await tx.user.update({where:{id},data:{isActive:input.isActive,version:{increment:1}},select:memberSelect});
   if(!input.isActive)await tx.session.deleteMany({where:{userId:id}});
   await this.audit.record(tx,actor,'TEAM',id,input.isActive?'MEMBER_ENABLED':'MEMBER_DISABLED',{name:member.name});
   return updated;
  });
 }
}
