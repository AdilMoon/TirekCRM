import {movementSource,receivedSql,expensesSql,cashFlowSql} from '../finance/ledger';
import {paidCents,paymentsWithRefunds} from '../../common/paid';
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClientInput, UpdateClientInput, OrganizationRecord, OrderInput, PaymentInput, ExpenseInput, Stage, stages, DocumentSnapshot, UpdateOrderInput } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { AuditService, Actor } from '../audit/audit.service';
import { clientRequisites,organizationRequisites } from '../documents/snapshot';
import { serializable } from '../../common/transaction';
import { cents, money, totalForItems } from '../../common/money';

export const orderInclude = { client: true, items: true, ...paymentsWithRefunds } satisfies Prisma.OrderInclude;
type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
const amount = (value: Prisma.Decimal | null | undefined) => value?.toFixed(2) ?? '0.00';
export function serializeOrder(order: FullOrder) {
  const paid = paidCents(order.payments);
  return { id:order.id,number:order.number,title:order.title,status:order.status,version:order.version,
    dueDate:order.dueDate,notes:order.notes,createdAt:order.createdAt,
    client:{id:order.client.id,...clientRequisites(order.client)},
    total:amount(order.total),paid:money(paid),debt:order.status==='CANCELLED'?'0.00':money(cents(amount(order.total))-paid),
    items:order.items.map(item=>({description:item.description,quantity:item.quantity,unitPrice:amount(item.unitPrice),total:amount(item.total)})),
  };
}
@Injectable()
export class CrmService {
  constructor(private readonly db: Database, private readonly audit:AuditService) {}
  private async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return serializable(this.db.client,fn);
  }
  async clients(org: string, query = '') {
    const clients = await this.db.client.client.findMany({
      where: { organizationId: org, ...(query ? { OR: ['name', 'company', 'phone'].map(field => ({ [field]: { contains: query, mode: 'insensitive' } })) } : {}) },
      include: { _count: { select: { orders: true } } }, orderBy: { createdAt: 'desc' }, take: 200,
    });
    return clients.map(client => ({ ...client, ordersCount: client._count.orders, _count: undefined }));
  }

  async createClient(org:string,input:ClientInput,actor:Actor) {
    return this.transaction(async tx=>{
      const client=await tx.client.create({data:{...input,organizationId:org}});
      await this.audit.record(tx,actor,'CLIENT',client.id,'CLIENT_CREATED',{name:client.name});
      return client;
    });
  }
  async updateClient(org:string,id:string,input:UpdateClientInput,actor:Actor) {
    return this.transaction(async tx=>{
      const previous=await tx.client.findFirst({where:{id,organizationId:org}});
      if(!previous)throw new NotFoundException('Клиент не найден');
      if(previous.version!==input.version)throw new ConflictException('Реквизиты клиента уже изменены. Обновите страницу');
      const {version,...data}=input;
      await tx.client.update({where:{id},data:{...data,version:{increment:1}}});
      await this.audit.record(tx,actor,'CLIENT',id,'CLIENT_UPDATED',{name:input.name});
      return {ok:true};
    });
  }
  async updateOrganization(org:string,input:OrganizationRecord,actor:Actor) {
    return this.transaction(async tx=>{
      const previous=await tx.organization.findUniqueOrThrow({where:{id:org}});
      if(previous.version!==input.version)throw new ConflictException('Реквизиты предприятия уже изменены. Обновите страницу');
      const {version,...data}=input;
      const organization=await tx.organization.update({where:{id:org},data:{...data,version:{increment:1}}});
      await this.audit.record(tx,actor,'ORGANIZATION',org,'ORGANIZATION_UPDATED',{name:input.name});
      return {...organizationRequisites(organization),version:organization.version};
    });
  }
  async order(org:string,id:string) {
    const order=await this.db.client.order.findFirst({where:{id,organizationId:org},include:orderInclude});
    if(!order)throw new NotFoundException('Заказ не найден');
    return serializeOrder(order);
  }
  async updateOrder(org:string,id:string,input:UpdateOrderInput,actor:Actor) {
    return this.transaction(async tx=>{
      const previous=await tx.order.findFirst({where:{id,organizationId:org},include:orderInclude});
      if(!previous)throw new NotFoundException('Заказ не найден');
      if(previous.version!==input.version)throw new ConflictException('Заказ уже изменён. Откройте его заново');
      if(['COMPLETED','CANCELLED'].includes(previous.status))throw new ConflictException('Завершённый или отменённый заказ нельзя редактировать');
      if(previous.payments.length && previous.clientId!==input.clientId)throw new ConflictException('Нельзя менять клиента после получения оплаты');
      if(!await tx.client.findFirst({where:{id:input.clientId,organizationId:org}}))throw new NotFoundException('Клиент не найден');
      const total=totalForItems(input.items);
      if(cents(total)>999999999999999999n)throw new ConflictException('Сумма заказа слишком велика');
      const paid=paidCents(previous.payments);
      if(cents(total)<paid)throw new ConflictException('Сумма заказа не может быть меньше полученной оплаты');
      const order=await tx.order.update({where:{id},data:{
        title:input.title,clientId:input.clientId,notes:input.notes,total,
        dueDate:input.dueDate?new Date(input.dueDate+'T00:00:00Z'):null,
        version:{increment:1},
        items:{deleteMany:{},create:input.items.map(item=>({...item,total:money(cents(item.unitPrice)*BigInt(item.quantity))}))},
      },include:orderInclude});
      await this.audit.record(tx,actor,'ORDER',id,'ORDER_UPDATED',{number:order.number,beforeTotal:amount(previous.total),total,version:order.version});
      return serializeOrder(order);
    });
  }
  async orders(org: string) {
    return (await this.db.client.order.findMany({ where: { organizationId: org }, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 200 })).map(serializeOrder);
  }
  async createOrder(org: string, input: OrderInput, actor:Actor) {
    return this.transaction(async tx => {
      const client = await tx.client.findFirst({ where: { id: input.clientId, organizationId: org } });
      if (!client) throw new NotFoundException('Клиент не найден');
      const organization = await tx.organization.update({ where: { id: org }, data: { orderSeq: { increment: 1 } } });
      const total = totalForItems(input.items);
      if (cents(total) > 999999999999999999n) throw new ConflictException('Сумма заказа слишком велика');
      const order = await tx.order.create({ data: {
        organizationId: org, clientId: input.clientId, title: input.title, notes: input.notes,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
        total, number: organization.orderSeq,
        items: { create: input.items.map(item => ({ ...item, total: money(cents(item.unitPrice) * BigInt(item.quantity)) })) },
      }, include: orderInclude });
      await this.audit.record(tx,actor,'ORDER',order.id,'ORDER_CREATED',{number:order.number,total});
      return serializeOrder(order);
    });
  }
  async changeStage(org: string, id: string, status: Stage, actor:Actor) {
    const transitions: Record<Stage, readonly Stage[]> = {
      NEW: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
    };
    return this.transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id, organizationId: org }, include: orderInclude });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status === status) return serializeOrder(order);
      if (!transitions[order.status].includes(status)) throw new ConflictException('Этот переход статуса недоступен');
      if (status === 'CANCELLED' && paidCents(order.payments)>0n) throw new ConflictException('Для отмены заказа сначала верните оставшуюся оплату');
      const updated=await tx.order.update({where:{id},data:{status,version:{increment:1}},include:orderInclude});
      await this.audit.record(tx,actor,'ORDER',id,'ORDER_STATUS_CHANGED',{number:order.number,from:order.status,to:status});
      return serializeOrder(updated);
    });
  }
  async payment(org: string, orderId: string, input: PaymentInput, actor:Actor) {
    return this.transaction(async tx => {
      const existing = await tx.payment.findUnique({ where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.orderId !== orderId || amount(existing.amount) !== money(cents(input.amount)) || existing.note !== input.note) throw new ConflictException('Ключ операции уже использован для другого платежа');
        return { ...existing, amount: amount(existing.amount) };
      }
      const order = await tx.order.findFirst({ where: { id: orderId, organizationId: org }, include: paymentsWithRefunds });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status === 'CANCELLED') throw new ConflictException('Отменённый заказ нельзя оплатить');
      const paid = paidCents(order.payments);
      if (paid + cents(input.amount) > cents(amount(order.total))) throw new ConflictException('Оплата превышает остаток по заказу');
      const payment = await tx.payment.create({ data: { organizationId: org, orderId, ...input } });
      await tx.order.update({where:{id:orderId},data:{version:{increment:1}}});
      await this.audit.record(tx,actor,'ORDER',orderId,'PAYMENT_RECORDED',{number:order.number,paymentId:payment.id,amount:amount(payment.amount)});
      return { ...payment, amount: amount(payment.amount) };
    });
  }
  async expense(org: string, input: ExpenseInput, actor:Actor) {
    return this.transaction(async tx => {
      const existing = await tx.expense.findUnique({ where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (amount(existing.amount) !== money(cents(input.amount)) || existing.orderId !== (input.orderId ?? null) || existing.description !== input.description || existing.category !== input.category) throw new ConflictException('Ключ операции уже использован');
        return { ...existing, amount: amount(existing.amount) };
      }
      if (input.orderId && !await tx.order.findFirst({ where: { id: input.orderId, organizationId: org } })) throw new NotFoundException('Заказ не найден');
      const expense = await tx.expense.create({ data: { ...input, organizationId: org } });
      await this.audit.record(tx,actor,'EXPENSE',expense.id,'EXPENSE_RECORDED',{amount:amount(expense.amount),category:expense.category});
      return { ...expense, amount: amount(expense.amount) };
    });
  }
  async movements(org: string) {
    const rows=await this.db.client.$queryRaw<{id:string;kind:string;amount:Prisma.Decimal;description:string;category:string;sourceId:string|null;orderId:string|null;orderNumber:number|null;createdAt:Date}[]>(Prisma.sql`SELECT id,kind,amount,description,category,"sourceId","orderId","orderNumber","createdAt" FROM (${movementSource(org)}) m ORDER BY "createdAt" DESC,id DESC,kind DESC LIMIT 200`);
    return rows.map(r=>({...r,category:r.category==='ORDER_PAYMENT'?'Оплата заказа':r.category,amount:r.amount.toFixed(2)}));
  }

  async documents(org: string) {
    const docs = await this.db.client.document.findMany({ where: { organizationId: org }, include: { order: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return docs.map(doc => { const snapshot = doc.snapshot as unknown as DocumentSnapshot; return {
      id: doc.id, number: doc.number, kind: doc.kind, status:doc.status, version:doc.version, orderId: doc.orderId, orderNumber: doc.order.number,
      clientName: snapshot.client.name, total: snapshot.invoice?.amountDue ?? snapshot.total, createdAt: doc.createdAt,
    }; });
  }
  async document(org: string, id: string) {
    const doc = await this.db.client.document.findFirst({ where: { id, organizationId: org } });
    if (!doc) throw new NotFoundException('Документ не найден');
    return doc;
  }
  async createDocument(org: string, orderId: string, actor:Actor) {
    return this.transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id: orderId, organizationId: org }, include: orderInclude });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status !== 'COMPLETED') throw new ConflictException('Акт доступен после выполнения заказа');
      const organization = await tx.organization.update({ where: { id: org }, data: { documentSeq: { increment: 1 } } });
      const snapshot: DocumentSnapshot = {
        organization: organizationRequisites(organization),
        client: clientRequisites(order.client),
        orderNumber: order.number, title: order.title, total: amount(order.total),
        items: order.items.map(item => ({ description: item.description, quantity: item.quantity, unitPrice: amount(item.unitPrice), total: amount(item.total) })),
      };
      const document=await tx.document.create({data:{organizationId:org,orderId,number:organization.documentSeq,snapshot:snapshot as unknown as Prisma.InputJsonValue}});
      await this.audit.record(tx,actor,'ORDER',orderId,'DOCUMENT_CREATED',{number:order.number,documentNumber:document.number,documentId:document.id});
      return document;
    });
  }
  async dashboard(org: string) {
    const db = this.db.client;
    const pipelineQuery=db.order.groupBy({by:['status'],where:{organizationId:org},_sum:{total:true},_count:true});
    const [documentsCount, clientsCount, pipeline, totals, owed, attention, monthly] = await db.$transaction([
      db.document.count({where:{organizationId:org}}),
      db.client.count({ where: { organizationId: org } }),
      pipelineQuery,
      db.$queryRaw<{received:Prisma.Decimal;expenses:Prisma.Decimal;cashFlow:Prisma.Decimal}[]>(Prisma.sql`SELECT ${receivedSql} AS received,${expensesSql} AS expenses,${cashFlowSql} AS "cashFlow" FROM (${movementSource(org)}) m`),
      db.$queryRaw<{outstanding:Prisma.Decimal}[]>(Prisma.sql`SELECT COALESCE(SUM(o.total-COALESCE(p.paid,0)),0) AS outstanding FROM "Order" o LEFT JOIN (SELECT "orderId",${receivedSql} AS paid FROM (${movementSource(org)}) m GROUP BY "orderId") p ON p."orderId"=o.id WHERE o."organizationId"=${org}::uuid AND o.status!='CANCELLED'`),
      db.order.findMany({ where: { organizationId: org, status: { in: ['NEW', 'CONFIRMED', 'IN_PROGRESS'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 5 }),
      db.$queryRaw<{month:string;income:Prisma.Decimal;expense:Prisma.Decimal}[]>(Prisma.sql`WITH months AS (SELECT generate_series(date_trunc('month', now() AT TIME ZONE 'Asia/Almaty')-interval '5 months',date_trunc('month',now() AT TIME ZONE 'Asia/Almaty'),interval '1 month') AS month), movements AS (${movementSource(org)}), totals AS (SELECT date_trunc('month',"createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Almaty') AS month,${receivedSql} AS income,${expensesSql} AS expense FROM movements GROUP BY 1) SELECT to_char(m.month,'YYYY-MM') AS month,COALESCE(t.income,0) AS income,COALESCE(t.expense,0) AS expense FROM months m LEFT JOIN totals t ON t.month=m.month ORDER BY m.month`),
    ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    const received=amount(totals[0].received),spent=amount(totals[0].expenses);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return {
      documentsCount, clientsCount, activeOrders: pipeline.filter(p => !['COMPLETED', 'CANCELLED'].includes(p.status)).reduce((s, p) => s + p._count, 0),
      completedValue: amount(pipeline.find(p => p.status === 'COMPLETED')?._sum.total), received, expenses: spent,
      cashFlow: amount(totals[0].cashFlow), outstanding: amount(owed[0]?.outstanding),
      pipeline: stages.map(status => ({ status, count: pipeline.find(p => p.status === status)?._count ?? 0, total: amount(pipeline.find(p => p.status === status)?._sum.total) })),
      monthly: monthly.map(m => ({ label: m.month, income: amount(m.income), expense: amount(m.expense) })),
      attention: attention.map(o => ({ id: o.id, number: o.number, title: o.title,
        reason: o.dueDate && o.dueDate.toISOString().slice(0,10) < today ? 'Срок выполнения прошёл' : o.status === 'NEW' ? 'Согласуйте условия с клиентом' : 'Проверьте следующий шаг по заказу' })),
    };
  }
}
