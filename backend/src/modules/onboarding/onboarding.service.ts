import { ConflictException,ForbiddenException,Injectable } from '@nestjs/common';
import type { RegistrationInput } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { hashPassword } from '../../auth/session.guard';
import { createSession } from '../../auth/session';
import { AuditService } from '../audit/audit.service';
import { serializable } from '../../common/transaction';
import { registrationEnabled } from './registration-config';
import { MailQueue } from '../mail/mail-queue';

@Injectable()
export class OnboardingService {
 constructor(private readonly db:Database,private readonly audit:AuditService,private readonly mail:MailQueue=new MailQueue()){}
 async register(input:RegistrationInput,userAgent:string,existingTokenHash?:string){
  if(!registrationEnabled())throw new ForbiddenException('Создание компаний сейчас недоступно');
  const passwordHash=await hashPassword(input.password);
  return serializable(this.db.client,async tx=>{
   if(existingTokenHash){
    const current=await tx.session.findFirst({where:{tokenHash:existingTokenHash,expiresAt:{gt:new Date()},user:{isActive:true}}});
    if(current)throw new ConflictException('Выйдите из текущего аккаунта перед созданием компании');
   }
   if(await tx.user.findUnique({where:{email:input.email}}))
    throw new ConflictException('Не удалось создать пространство. Если аккаунт уже есть, войдите.');
   const organization=await tx.organization.create({data:{name:input.companyName}});
   const owner=await tx.user.create({data:{organizationId:organization.id,name:input.ownerName,email:input.email,passwordHash,role:'OWNER'}});
   const session=await createSession(tx,owner.id,userAgent);
   await this.audit.record(tx,owner,'ORGANIZATION',organization.id,'ORGANIZATION_CREATED');
   await this.mail.enqueue(tx,owner,'WELCOME','welcome:'+owner.id);
   return session;
  });
 }
}
