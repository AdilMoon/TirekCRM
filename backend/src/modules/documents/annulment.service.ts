import {ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import type {AnnulDocumentInput} from '@tirek/contracts';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {AuditService,Actor} from '../audit/audit.service';

@Injectable()
export class AnnulmentService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 async annul(org:string,id:string,input:AnnulDocumentInput,actor:Actor){
  return serializable(this.db.client,async tx=>{
   const owner=await tx.user.findFirst({where:{id:actor.id,organizationId:org,role:'OWNER',isActive:true}});
   if(!owner)throw new ForbiddenException('Недостаточно прав');
   const doc=await tx.document.findFirst({where:{id,organizationId:org}});
   if(!doc)throw new NotFoundException('Документ не найден');
   if(doc.annulmentKey===input.idempotencyKey){
    if(doc.version!==input.version+1||doc.annulmentReason!==input.reason||doc.annulledById!==actor.id)
     throw new ConflictException('Этот ключ уже использован для другого аннулирования');
    return doc;
   }
   const used=await tx.document.findUnique({where:{organizationId_annulmentKey:{organizationId:org,annulmentKey:input.idempotencyKey}}});
   if(used)throw new ConflictException('Этот ключ уже использован для другого аннулирования');
   if(doc.status!=='DRAFT'||doc.version!==input.version)
    throw new ConflictException('Документ уже изменён. Обновите страницу');
   if(!['ACT_DRAFT','INVOICE_DRAFT'].includes(doc.kind))
    throw new ConflictException('Можно аннулировать только черновик');
   const updated=await tx.document.update({where:{id:doc.id},data:{status:'ANNULLED',version:{increment:1},annulledAt:new Date(),annulledById:owner.id,annulledByName:owner.name,annulmentReason:input.reason,annulmentKey:input.idempotencyKey}});
   const order=await tx.order.findUniqueOrThrow({where:{id:doc.orderId}});
   // Keep free-text reasons in the protected document, not duplicate them in audit metadata.
   await this.audit.record(tx,{id:owner.id,name:owner.name,organizationId:org},'ORDER',doc.orderId,'DOCUMENT_ANNULLED',{number:order.number,documentId:doc.id,documentNumber:doc.number});
   return updated;
  });
 }
}
