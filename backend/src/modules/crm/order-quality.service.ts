import {ConflictException, ForbiddenException, Injectable, NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {acceptanceConfigSchema,repeatVisitSchema} from '@tirek/contracts';
import type {z} from 'zod';
import type {AuthRequest} from '../../auth/session.guard';
import {Database} from '../../database/database.service';
import {AuditService} from '../audit/audit.service';
import {serializable} from '../../common/transaction';
import {acceptanceAccess,acceptanceState,checkAcceptance,readAcceptance} from '../tasks/acceptance';
import {publishTaskNotification} from '../notifications/notification-writer';

type Actor=AuthRequest['user'];
@Injectable()
export class OrderQualityService {
  constructor(private readonly db:Database,private readonly audit:AuditService){}
  read(actor:Actor,id:string) {
    return this.db.client.$transaction(tx=>readAcceptance(tx,actor,id),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  check(actor:Actor,id:string,input:{version:number;itemId:string;checked:boolean}) {
    return serializable(this.db.client,tx=>checkAcceptance(tx,this.audit,actor,id,input));
  }
  configure(actor:Actor,id:string,input:z.infer<typeof acceptanceConfigSchema>) {
    return serializable(this.db.client,async tx=>{
      const access=await acceptanceAccess(tx,actor,id);
      if(!access.canConfigure) throw new ForbiddenException('Чек-лист можно менять до завершения заказа');
      const prior=await acceptanceState(tx,id);
      if(prior.version!==input.version) throw new ConflictException('Чек-лист изменился. Обновите данные');
      const items=input.items.map(item=>{
        const previous=prior.items.find(row=>row.id===item.id&&row.label===item.label&&row.required===item.required);
        return {...item,checked:previous?.checked??false,checkedBy:previous?.checkedBy??null};
      });
      await tx.orderAcceptance.upsert({where:{orderId:id},create:{orderId:id,organizationId:actor.organizationId,items},
        update:{version:{increment:1},items}});
      await this.audit.record(tx,actor,'ORDER',id,'ACCEPTANCE_CONFIGURED',{previous:prior.items.map(item=>({...item})),items});
      return readAcceptance(tx,actor,id);
    });
  }
  repeat(actor:Actor,id:string,input:z.infer<typeof repeatVisitSchema>) {
    const fingerprint=createHash('sha256').update(JSON.stringify({id,reason:input.reason,assigneeId:input.assigneeId})).digest('hex');
    return serializable(this.db.client,async tx=>{
      const user=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true,role:'OWNER'}});
      if(!user) throw new ForbiddenException();
      const prior=await tx.order.findUnique({where:{organizationId_repeatKey:{organizationId:actor.organizationId,repeatKey:input.idempotencyKey}}});
      if(prior) {
        if(prior.repeatRequestHash!==fingerprint)
          throw new ConflictException('Ключ операции уже использован');
        return {id:prior.id,number:prior.number,title:prior.title,status:prior.status};
      }
      const original=await tx.order.findFirst({where:{id,organizationId:actor.organizationId}});
      if(!original) throw new NotFoundException('Заказ не найден');
      if(original.repeatOfId || original.status!=='COMPLETED') throw new ConflictException('Повторный выезд доступен для исходного выполненного заказа');
      if(await tx.order.count({where:{organizationId:actor.organizationId,repeatOfId:id}})>=50)
        throw new ConflictException('Достигнут лимит повторных выездов по заказу');
      if(!await tx.user.findFirst({where:{id:input.assigneeId,organizationId:actor.organizationId,isActive:true}}))
        throw new NotFoundException('Активный исполнитель не найден');
      const org=await tx.organization.update({where:{id:actor.organizationId},data:{orderSeq:{increment:1}}});
      const visit=await tx.order.create({data:{organizationId:actor.organizationId,clientId:original.clientId,
        repeatOfId:id,repeatKey:input.idempotencyKey,repeatRequestHash:fingerprint,number:org.orderSeq,title:'Повторный выезд · № '+original.number,
        total:'0.00',notes:input.reason,
        actualHourlyRate:original.actualHourlyRate}});
      const acceptance=await acceptanceState(tx,id);
      if(acceptance.items.length) await tx.orderAcceptance.create({data:{orderId:visit.id,organizationId:actor.organizationId,
        items:acceptance.items.map(item=>({...item,checked:false,checkedBy:null}))}});
      const task=await tx.businessTask.create({data:{organizationId:actor.organizationId,orderId:visit.id,
        createdById:actor.id,assigneeId:input.assigneeId,title:visit.title,description:input.reason}});
      await publishTaskNotification(tx,{organizationId:actor.organizationId,taskId:task.id,actorId:actor.id,
        actorName:actor.name,kind:'TASK_ASSIGNED',eventKey:'task:'+task.id+':assigned:1'});
      await this.audit.record(tx,actor,'ORDER',id,'REPEAT_VISIT_CREATED',{visitId:visit.id,number:visit.number,reason:input.reason});
      return {id:visit.id,number:visit.number,title:visit.title,status:visit.status};
    });
  }
}
