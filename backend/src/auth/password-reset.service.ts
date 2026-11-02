import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Database } from '../database/database.service';
import { AuditService } from '../modules/audit/audit.service';
import { serializable } from '../common/transaction';
import { digest, hashPassword } from './session.guard';
import { PasswordResetDelivery } from './password-reset-delivery';
import { MailQueue } from '../modules/mail/mail-queue';

export const RESET_TTL_MS=15*60*1000, RESET_COOLDOWN_MS=60*1000;
const invalid=()=>new BadRequestException('Токен восстановления недействителен или истёк');
@Injectable()
export class PasswordResetService {
  private readonly logger=new Logger('PasswordReset');
  constructor(private readonly db:Database,private readonly audit:AuditService,private readonly delivery:PasswordResetDelivery,private readonly mail:MailQueue=new MailQueue()){}
  status(){return {enabled:this.delivery.enabled};}
  private available(){if(!this.delivery.enabled)throw new ServiceUnavailableException('Восстановление пароля сейчас недоступно');}
  async request(email:string){
    this.available();
    const start=performance.now(),minimum=250+randomInt(26);
    try{
      const issued=await serializable(this.db.client,async tx=>{
        const user=await tx.user.findUnique({where:{email:email.trim().toLowerCase()}});
        if(!user?.isActive)return null;
        const now=new Date(),previous=await tx.passwordReset.findUnique({where:{userId:user.id}});
        if(previous&&previous.requestedAt.getTime()>now.getTime()-RESET_COOLDOWN_MS&&previous.expiresAt>now)return null;
        const token=randomBytes(32).toString('hex'),tokenHash=digest(token),expiresAt=new Date(now.getTime()+RESET_TTL_MS);
        const data={tokenHash,credentialHash:digest(user.passwordHash),requestedAt:now,expiresAt};
        await tx.passwordReset.upsert({where:{userId:user.id},create:{userId:user.id,...data},update:data});
        return {userId:user.id,organizationId:user.organizationId,to:user.email,token,tokenHash,expiresAt};
      });
      if(issued){
        try{await this.delivery.send({userId:issued.userId,organizationId:issued.organizationId,to:issued.to,token:issued.token,expiresAt:issued.expiresAt});}
        catch{
          // Preserve the same public response, and never delete a newer token on cleanup.
          this.logger.warn('PASSWORD_RESET_DELIVERY_FAILED');
          await this.db.client.passwordReset.deleteMany({where:{userId:issued.userId,tokenHash:issued.tokenHash}}).catch(()=>this.logger.error('PASSWORD_RESET_CLEANUP_FAILED'));
        }
      }
      return {ok:true};
    }finally{await delay(Math.max(0,minimum-(performance.now()-start)));}
  }
  async confirm(token:string,newPassword:string){
    this.available();
    const passwordHash=await hashPassword(newPassword);
    return serializable(this.db.client,async tx=>{
      const reset=await tx.passwordReset.findUnique({where:{tokenHash:digest(token.toLowerCase())},include:{user:true}});
      if(!reset||reset.expiresAt<=new Date()||!reset.user.isActive||reset.credentialHash!==digest(reset.user.passwordHash))throw invalid();
      const user=reset.user;
      await tx.user.update({where:{id:user.id},data:{passwordHash}});
      await tx.session.deleteMany({where:{userId:user.id}});
      await tx.passwordReset.delete({where:{userId:user.id}});
      await this.audit.record(tx,user,'ACCOUNT',user.id,'PASSWORD_CHANGED',{method:'recovery'});
      await this.mail.enqueue(tx,user,'PASSWORD_CHANGED');
      // Recovery never authenticates a browser or changes anyone else's cookie.
      return {ok:true};
    });
  }
}
