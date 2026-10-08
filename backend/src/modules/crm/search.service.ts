import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListQuery, OrderQuery } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { orderInclude, serializeOrder } from './crm.service';
@Injectable()
export class SearchService {
 constructor(private readonly db:Database) {}
 async clients(org:string,query:ListQuery) {
  const where:Prisma.ClientWhereInput={organizationId:org,...(query.q?{OR:['name','phone','company','email'].map(field=>({[field]:{contains:query.q,mode:'insensitive'}}))}:{})};
  const [rows,total]=await this.db.client.$transaction([
   this.db.client.client.findMany({where,select:{id:true,name:true,phone:true,email:true,company:true,address:true,createdAt:true,_count:{select:{orders:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),
   this.db.client.client.count({where}),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  return {items:rows.map(({_count,...row})=>({...row,ordersCount:_count.orders})),total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize)};
 }
 async orders(org:string,query:OrderQuery) {
  const number=/^\d+$/.test(query.q)?Number(query.q):NaN;
  const where:Prisma.OrderWhereInput={organizationId:org,...(query.status?{status:query.status}:{}),...(query.q?{OR:[
   {title:{contains:query.q,mode:'insensitive'}},{client:{name:{contains:query.q,mode:'insensitive'}}},
   {client:{company:{contains:query.q,mode:'insensitive'}}},
   ...(Number.isSafeInteger(number)&&number<=2147483647?[{number}]:[]),
  ]}:{})};
  const [rows,total]=await this.db.client.$transaction([
   this.db.client.order.findMany({where,include:orderInclude,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),
   this.db.client.order.count({where}),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  return {items:rows.map(serializeOrder),total,page:query.page,pageSize:query.pageSize,pages:Math.ceil(total/query.pageSize)};
 }
}
