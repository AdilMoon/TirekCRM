import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClientInput, OrderInput, PaymentInput, ExpenseInput, Stage, stages, DocumentSnapshot, UpdateOrderInput, OrganizationInput } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { AuditService, Actor } from '../audit/audit.service';
import { serializable } from '../../common/transaction';
import { cents, money, totalForItems } from '../../common/money';

export const orderInclude = { client: true, items: true, payments: true } satisfies Prisma.OrderInclude;
type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
const amount = (value: Prisma.Decimal | null | undefined) => value?.toFixed(2) ?? '0.00';
export function serializeOrder(order: FullOrder) {
  const paid = order.payments.reduce((sum, p) => sum + cents(p.amount.toFixed(2)), 0n);
  return { id:order.id,number:order.number,title:order.title,status:order.status,version:order.version,
    dueDate:order.dueDate,notes:order.notes,createdAt:order.createdAt,
    client:{id:order.client.id,name:order.client.name,phone:order.client.phone,email:order.client.email,company:order.client.company,address:order.client.address},
    total:amount(order.total),paid:money(paid),debt:money(cents(amount(order.total))-paid),
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
  async updateClient(org:string,id:string,input:ClientInput,actor:Actor) {
    return this.transaction(async tx=>{
      const previous=await tx.client.findFirst({where:{id,organizationId:org}});
      if(!previous)throw new NotFoundException('Клиент не найден');
      await tx.client.update({where:{id},data:input});
      await this.audit.record(tx,actor,'CLIENT',id,'CLIENT_UPDATED',{name:input.name});
      return {ok:true};
    });
  }
  async updateOrganization(org:string,input:OrganizationInput,actor:Actor) {
    return this.transaction(async tx=>{
      const organization=await tx.organization.update({where:{id:org},data:input,select:{name:true,address:true,businessId:true}});
      await this.audit.record(tx,actor,'ORGANIZATION',org,'ORGANIZATION_UPDATED',{name:input.name});
      return organization;
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
      const paid=previous.payments.reduce((sum,p)=>sum+cents(amount(p.amount)),0n);
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
      if (status === 'CANCELLED' && order.payments.length) throw new ConflictException('У заказа есть оплаты. Сначала требуется оформить возврат; возвраты появятся в следующей версии');
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
      const order = await tx.order.findFirst({ where: { id: orderId, organizationId: org }, include: { payments: true } });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status === 'CANCELLED') throw new ConflictException('Отменённый заказ нельзя оплатить');
      const paid = order.payments.reduce((sum, p) => sum + cents(amount(p.amount)), 0n);
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
    const [payments, expenses] = await Promise.all([
      this.db.client.payment.findMany({ where: { organizationId: org }, include: { order: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.db.client.expense.findMany({ where: { organizationId: org }, include: { order: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    return [
      ...payments.map(p => ({ id: p.id, kind: 'INCOME', amount: amount(p.amount), description: p.note || p.order.title, category: 'Оплата заказа', orderNumber: p.order.number, createdAt: p.createdAt })),
      ...expenses.map(e => ({ id: e.id, kind: 'EXPENSE', amount: amount(e.amount), description: e.description, category: e.category, orderNumber: e.order?.number ?? null, createdAt: e.createdAt })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200);
  }
  async documents(org: string) {
    const docs = await this.db.client.document.findMany({ where: { organizationId: org }, include: { order: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return docs.map(doc => { const snapshot = doc.snapshot as unknown as DocumentSnapshot; return {
      id: doc.id, number: doc.number, kind: doc.kind, orderId: doc.orderId, orderNumber: doc.order.number,
      clientName: snapshot.client.name, total: snapshot.total, createdAt: doc.createdAt,
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
        organization: { name: organization.name, address: organization.address, businessId: organization.businessId },
        client: { name: order.client.name, company: order.client.company, phone: order.client.phone, email: order.client.email, address: order.client.address },
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
    const [documentsCount, clientsCount, pipeline, payments, expenses, owed, attention, monthly] = await Promise.all([
      db.document.count({where:{organizationId:org}}),
      db.client.count({ where: { organizationId: org } }),
      db.order.groupBy({ by: ['status'], where: { organizationId: org }, _sum: { total: true }, _count: true }),
      db.payment.aggregate({ where: { organizationId: org }, _sum: { amount: true } }),
      db.expense.aggregate({ where: { organizationId: org }, _sum: { amount: true } }),
      db.$queryRaw<{ outstanding: Prisma.Decimal }[]>`SELECT COALESCE(SUM(o.total - COALESCE(p.paid, 0)), 0) AS outstanding FROM "Order" o LEFT JOIN (SELECT "orderId", SUM(amount) AS paid FROM "Payment" WHERE "organizationId" = ${org}::uuid GROUP BY "orderId") p ON p."orderId" = o.id WHERE o."organizationId" = ${org}::uuid AND o.status != 'CANCELLED'`,
      db.order.findMany({ where: { organizationId: org, status: { in: ['NEW', 'CONFIRMED', 'IN_PROGRESS'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 5 }),
      db.$queryRaw<{ month: string; income: Prisma.Decimal; expense: Prisma.Decimal }[]>`WITH months AS (SELECT generate_series(date_trunc('month', now() AT TIME ZONE 'Asia/Almaty') - interval '5 months', date_trunc('month', now() AT TIME ZONE 'Asia/Almaty'), interval '1 month') AS month), ins AS (SELECT date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Almaty') AS month, SUM(amount) AS amount FROM "Payment" WHERE "organizationId" = ${org}::uuid GROUP BY 1), outs AS (SELECT date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Almaty') AS month, SUM(amount) AS amount FROM "Expense" WHERE "organizationId" = ${org}::uuid GROUP BY 1) SELECT to_char(m.month, 'YYYY-MM') AS month, COALESCE(i.amount,0) AS income, COALESCE(e.amount,0) AS expense FROM months m LEFT JOIN ins i ON i.month=m.month LEFT JOIN outs e ON e.month=m.month ORDER BY m.month`,
    ]);
    const received = amount(payments._sum.amount), spent = amount(expenses._sum.amount);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return {
      documentsCount, clientsCount, activeOrders: pipeline.filter(p => !['COMPLETED', 'CANCELLED'].includes(p.status)).reduce((s, p) => s + p._count, 0),
      completedValue: amount(pipeline.find(p => p.status === 'COMPLETED')?._sum.total), received, expenses: spent,
      cashFlow: money(cents(received) - cents(spent)), outstanding: amount(owed[0]?.outstanding),
      pipeline: stages.map(status => ({ status, count: pipeline.find(p => p.status === status)?._count ?? 0, total: amount(pipeline.find(p => p.status === status)?._sum.total) })),
      monthly: monthly.map(m => ({ label: m.month, income: amount(m.income), expense: amount(m.expense) })),
      attention: attention.map(o => ({ id: o.id, number: o.number, title: o.title,
        reason: o.dueDate && o.dueDate.toISOString().slice(0,10) < today ? 'Срок выполнения прошёл' : o.status === 'NEW' ? 'Согласуйте условия с клиентом' : 'Проверьте следующий шаг по заказу' })),
    };
  }
}
