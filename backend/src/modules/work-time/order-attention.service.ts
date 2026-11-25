import {ForbiddenException,Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {attentionReasons,type AttentionIssue,type AttentionOrder,type OrderAttention,type attentionQuerySchema} from '@tirek/contracts';
import type {z} from 'zod';
import type {AuthRequest} from '../../auth/session.guard';
import {Database} from '../../database/database.service';
import {money} from '../../common/money';
import {readProfitabilities} from './profitability-reader';
import {almatyTime} from '../scheduling/planner';

const active=['NEW','CONFIRMED','IN_PROGRESS'] as const;
const value=(amount:string)=>BigInt(amount.replace('.',''));
@Injectable()
export class OrderAttentionService {
  constructor(private readonly db:Database){}
  list(actor:AuthRequest['user'],query:z.infer<typeof attentionQuerySchema>):Promise<OrderAttention> {
    return this.db.client.$transaction(async tx=>{
      const organizationId=actor.organizationId;
      if(!await tx.user.findFirst({where:{id:actor.id,organizationId,role:'OWNER',isActive:true},select:{id:true}}))
        throw new ForbiddenException('Недостаточно прав');
      const now=new Date();
      const today=almatyTime(now).day;
      const number=/^\d+$/.test(query.q)?Number(query.q):NaN;
      const numbered=Number.isSafeInteger(number)&&number<=2147483647?{number}:undefined;
      const pending={expenseReceipts:{some:{status:'PENDING' as const}}};
      const pendingService={serviceRequests:{some:{status:'NEW' as const}}};
      const pendingTime={workTimeAllocations:{some:{entry:{status:'SUBMITTED' as const,kind:{not:'ABSENCE' as const}}}}};
      const unpricedTime={actualHourlyRate:null,workTimeAllocations:{some:{entry:{status:'APPROVED' as const,kind:{not:'ABSENCE' as const}}}}};
      const where:Prisma.OrderWhereInput={organizationId,repeatOfId:null,AND:[
        {OR:[{status:{in:[...active]}},pending,pendingTime,unpricedTime,pendingService,
          {repeatVisits:{some:{OR:[{status:{in:[...active]}},pending,pendingTime,unpricedTime,pendingService]}}}]},
        ...(query.q?[{OR:[{title:{contains:query.q,mode:'insensitive' as const}},{client:{name:{contains:query.q,mode:'insensitive' as const}}},
          {client:{company:{contains:query.q,mode:'insensitive' as const}}},
          ...(numbered?[numbered,{repeatVisits:{some:numbered}}]:[])]}]:[]),
      ]};
      const rows:AttentionOrder[]=[];
      let cursor:string|undefined;
      for(;;) {
        const roots=await tx.order.findMany({where,select:{id:true,number:true,title:true,status:true,client:{select:{name:true}},
          dueDate:true,repeatVisits:{select:{id:true,number:true,status:true,dueDate:true},orderBy:{number:'asc'}}},
          orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
        if(!roots.length)break;
        const profit=await readProfitabilities(tx,organizationId,roots.map(order=>order.id));
        const ids=roots.flatMap(order=>[order.id,...order.repeatVisits.map(visit=>visit.id)]);
        const receipts=await tx.expenseReceipt.groupBy({by:['orderId'],where:{organizationId,orderId:{in:ids},status:'PENDING'},_count:{_all:true}});
        const quotes=await tx.orderQuote.groupBy({by:['orderId'],where:{organizationId,orderId:{in:ids},
          acceptedAt:null,revokedAt:null,expiresAt:{lte:now},order:{status:{in:[...active]}}},_count:{_all:true}});
        const receiptCounts=new Map(receipts.map(row=>[row.orderId,row._count._all]));
        const requests=await tx.serviceRequest.groupBy({by:['sourceOrderId'],where:{organizationId,sourceOrderId:{in:ids},status:'NEW'},_count:{_all:true}});
        const requestCounts=new Map(requests.map(row=>[row.sourceOrderId,row._count._all]));
        const quoteCounts=new Map(quotes.map(row=>[row.orderId,row._count._all]));
        for(const root of roots) {
          const detail=profit.get(root.id)!;
          const issues:AttentionIssue[]=[];
          if(detail.forecast.atCompletion.profit!==null&&value(detail.forecast.atCompletion.profit)<0n)
            issues.push({reason:'LOSS',orderId:root.id,number:root.number,target:'profitability',count:1});
          for(const source of [root,...root.repeatVisits]) {
            const cost=profit.get(source.id)!;
            const add=(reason:AttentionIssue['reason'],target:AttentionIssue['target'],count=1)=>
              issues.push({reason,orderId:source.id,number:source.number,target,count});
            if(cost.forecast.atCompletion.labor===null||cost.forecast.remainingExpenses===null)add('INCOMPLETE','profitability');
            const receiptCount=receiptCounts.get(source.id)??0;
            if(receiptCount)add('RECEIPTS','profitability',receiptCount);
            const requestCount=requestCounts.get(source.id)??0;
            if(requestCount)add('SERVICE_REQUEST','service-object',requestCount);
            const quoteCount=quoteCounts.get(source.id)??0;
            if(quoteCount)add('APPROVAL','quotes',quoteCount);
            if(cost.plannedMinutes!==null&&cost.actualMinutes>cost.plannedMinutes)add('OVERRUN','effort',cost.actualMinutes-cost.plannedMinutes);
            if(cost.pendingMinutes>0)add('TIME_REVIEW','effort',cost.pendingMinutes);
            if(active.includes(source.status as typeof active[number])&&source.dueDate&&source.dueDate.toISOString().slice(0,10)<today)
              add('DEADLINE','details');
          }
          if(issues.length)rows.push({id:root.id,number:root.number,title:root.title,clientName:root.client.name,status:root.status,
            actualProfit:detail.actual.profit,forecastProfit:detail.forecast.atCompletion.profit,issues});
        }
        cursor=roots.at(-1)!.id;
      }
      rows.sort((a,b)=>{
        const lossA=a.forecastProfit!==null&&value(a.forecastProfit)<0n;
        const lossB=b.forecastProfit!==null&&value(b.forecastProfit)<0n;
        if(lossA!==lossB)return lossA?-1:1;
        if(lossA&&lossB&&a.forecastProfit!==b.forecastProfit)return value(a.forecastProfit!)<value(b.forecastProfit!)?-1:1;
        return a.number-b.number||a.id.localeCompare(b.id);
      });
      const reasons=Object.fromEntries(attentionReasons.map(reason=>[reason,rows.filter(row=>row.issues.some(issue=>issue.reason===reason)).length])) as OrderAttention['summary']['reasons'];
      const loss=rows.reduce((sum,row)=>row.forecastProfit!==null&&value(row.forecastProfit)<0n?sum-value(row.forecastProfit):sum,0n);
      const filtered=query.reason?rows.filter(row=>row.issues.some(issue=>issue.reason===query.reason)):rows;
      const pageSize=20;
      return {asOf:now.toISOString(),summary:{orders:rows.length,forecastLoss:money(loss),reasons},
        items:filtered.slice((query.page-1)*pageSize,query.page*pageSize),total:filtered.length,page:query.page,pageSize,pages:Math.ceil(filtered.length/pageSize)};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:20000});
  }
}
