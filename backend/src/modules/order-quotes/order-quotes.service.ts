import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { OrderQuote, Prisma } from '@prisma/client';
import type { PublishQuoteInput, QuoteSnapshot } from '@tirek/contracts';
import { digest } from '../../auth/session.guard';
import { cents, money } from '../../common/money';
import { orderTermsHash } from '../../common/order-terms';
import { serializable } from '../../common/transaction';
import { webOrigin } from '../../common/web-origin';
import { Database } from '../../database/database.service';
import { AuditService, type Actor } from '../audit/audit.service';
import { publishQuoteNotifications } from '../notifications/notification-writer';

const orderTerms = {
  id: true, organizationId: true, clientId: true, title: true, number: true, version: true, status: true, total: true, repeatOfId:true,
  organization: { select: { name: true } },
  items: { orderBy: { id: 'asc' }, select: { description: true, quantity: true, unitPrice: true } },
} satisfies Prisma.OrderSelect;
type QuoteOrder = Prisma.OrderGetPayload<{ select: typeof orderTerms }>;
const maxAmount = 999999999999999999n;
const quoteUnavailable = () => new NotFoundException('Ссылка на смету недоступна или истекла');
const quoteChanged = () => new ConflictException('Условия заказа изменились. Попросите отправить новую смету');
const open = (order: QuoteOrder) => order.status !== 'COMPLETED' && order.status !== 'CANCELLED';
const basis = (order: QuoteOrder) => orderTermsHash({
  ...order,
  total: order.total.toFixed(2),
  items: order.items.map(line => ({ ...line, unitPrice: line.unitPrice.toFixed(2) })),
});

function publicView(quote: OrderQuote, order: QuoteOrder, now: Date) {
  let status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'STALE' = 'PENDING';
  if (quote.acceptedAt) status = 'ACCEPTED';
  else if (quote.revokedAt) status = 'REVOKED';
  else if (quote.expiresAt <= now) status = 'EXPIRED';
  else if (!open(order) || basis(order) !== quote.basisHash) status = 'STALE';
  return {
    kind: quote.kind, revision: quote.revision, createdAt: quote.createdAt, expiresAt: quote.expiresAt,
    acceptedAt: quote.acceptedAt, status, snapshot: quote.snapshot as unknown as QuoteSnapshot,
  };
}

@Injectable()
export class OrderQuotesService {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  private async order(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    const order = await tx.order.findFirst({ where: { id, organizationId: actor.organizationId }, select: orderTerms });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  private async owner(tx: Prisma.TransactionClient, actor: Actor) {
    const found = await tx.user.findFirst({
      where: { id: actor.id, organizationId: actor.organizationId, isActive: true, role: 'OWNER' }, select: { id: true },
    });
    if (!found) throw new ForbiddenException('Недостаточно прав');
  }

  async list(actor: Actor, id: string) {
    return this.db.client.$transaction(async tx => {
      const order = await this.order(tx, actor, id);
      const where = { orderId: id, organizationId: actor.organizationId };
      const entries = await tx.orderQuote.findMany({ where, orderBy: { revision: 'desc' }, take: 30 });
      const hasAcceptedBase = !!await tx.orderQuote.findFirst({
        where: { ...where, kind: 'BASE', acceptedAt: { not: null } }, select: { id: true },
      });
      const now = new Date();
      return {
        orderVersion: order.version, orderTotal: order.total.toFixed(2), canPublish: open(order), hasAcceptedBase,
        entries: entries.map(quote => ({ ...publicView(quote, order, now), id: quote.id, revokedAt: quote.revokedAt })),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  publish(actor: Actor, id: string, input: PublishQuoteInput) {
    const origin = webOrigin();
    if (process.env.NODE_ENV === 'production' && !origin.startsWith('https:')) {
      throw new BadRequestException('Для сметы нужен HTTPS');
    }
    const token = randomBytes(32).toString('hex');
    return serializable(this.db.client, async tx => {
      await this.owner(tx, actor);
      const order = await this.order(tx, actor, id);
      if (!open(order)) throw new ConflictException('Смета доступна для открытого заказа');
      if(order.repeatOfId) throw new ConflictException('Для платных работ создайте отдельное согласование в исходном заказе');
      if (order.version !== input.orderVersion) throw new ConflictException('Заказ уже изменён. Откройте его заново');
      const now = new Date();
      const where = { orderId: id, organizationId: actor.organizationId };
      const acceptedBase = await tx.orderQuote.findFirst({
        where: { ...where, kind: 'BASE', acceptedAt: { not: null } }, select: { id: true },
      });
      if (input.kind === 'BASE' && acceptedBase) throw new ConflictException('Основная смета уже согласована');
      if (input.kind === 'EXTRA' && !acceptedBase) throw new ConflictException('Сначала согласуйте основную смету');
      await tx.orderQuote.updateMany({
        where: { ...where, acceptedAt: null, revokedAt: null, expiresAt: { lte: now } }, data: { revokedAt: now },
      });
      if (await tx.orderQuote.findFirst({ where: { ...where, acceptedAt: null, revokedAt: null }, select: { id: true } })) {
        throw new ConflictException('Сначала отзовите действующее предложение');
      }
      const source = input.kind === 'BASE'
        ? order.items.map(line => ({ ...line, unitPrice: line.unitPrice.toFixed(2) }))
        : input.items;
      if (!source.length || (input.kind === 'EXTRA' && order.items.length + source.length > 100)) {
        throw new ConflictException('В заказе должно быть от 1 до 100 позиций');
      }
      const items = source.map(line => ({
        description: line.description, quantity: line.quantity, unitPrice: money(cents(line.unitPrice)),
        total: money(cents(line.unitPrice) * BigInt(line.quantity)),
      }));
      const subtotal = items.reduce((sum, line) => sum + cents(line.total), 0n);
      const current = cents(order.total.toFixed(2));
      if (input.kind === 'BASE' && subtotal !== current) throw quoteChanged();
      const after = input.kind === 'BASE' ? subtotal : current + subtotal;
      if (after > maxAmount) throw new ConflictException('Сумма заказа слишком велика');
      const snapshot: QuoteSnapshot = {
        companyName: order.organization.name, title: order.title, orderNumber: order.number,
        items, beforeTotal: money(current), afterTotal: money(after),
      };
      const last = await tx.orderQuote.findFirst({ where, orderBy: { revision: 'desc' }, select: { revision: true } });
      const quote = await tx.orderQuote.create({ data: {
        ...where, revision: (last?.revision ?? 0) + 1, kind: input.kind, basisHash: basis(order),
        snapshot: snapshot as unknown as Prisma.InputJsonValue, tokenHash: digest(token),
        createdAt: now, expiresAt: new Date(+now + 7 * 86400000),
      } });
      await this.audit.record(tx, actor, 'ORDER', id, 'ORDER_QUOTE_PUBLISHED', {
        number: order.number, quoteId: quote.id, revision: quote.revision, kind: quote.kind,
      });
      return { id: quote.id, url: origin + '/quote#token=' + token, expiresAt: quote.expiresAt };
    });
  }

  revoke(actor: Actor, id: string, quoteId: string) {
    return serializable(this.db.client, async tx => {
      await this.owner(tx, actor);
      const order = await this.order(tx, actor, id);
      const quote = await tx.orderQuote.findFirst({
        where: { id: quoteId, orderId: id, organizationId: actor.organizationId }, select: { revokedAt: true },
      });
      if (!quote) throw quoteUnavailable();
      if (!quote.revokedAt) {
        await tx.orderQuote.update({ where: { id: quoteId }, data: { revokedAt: new Date() } });
        await this.audit.record(tx, actor, 'ORDER', id, 'ORDER_QUOTE_REVOKED', { number: order.number, quoteId });
      }
      return { ok: true };
    });
  }

  private async lookup(tx: Prisma.TransactionClient, token: string, now: Date) {
    const quote = await tx.orderQuote.findUnique({ where: { tokenHash: digest(token) }, include: { order: { select: orderTerms } } });
    if (!quote || quote.revokedAt || quote.expiresAt <= now) throw quoteUnavailable();
    return quote;
  }

  async read(token: string) {
    const now = new Date();
    const quote = await this.lookup(this.db.client, token, now);
    return publicView(quote, quote.order, now);
  }

  accept(token: string, revision: number) {
    return serializable(this.db.client, async tx => {
      const now = new Date();
      const quote = await this.lookup(tx, token, now);
      if (quote.revision !== revision) throw quoteChanged();
      if (quote.acceptedAt) return { acceptedAt: quote.acceptedAt };
      if (!open(quote.order) || quote.basisHash !== basis(quote.order)) throw quoteChanged();
      const snapshot = quote.snapshot as unknown as QuoteSnapshot;
      await tx.order.update({ where: { id: quote.orderId }, data: {
        version: { increment: 1 },
        ...(quote.kind === 'BASE' && quote.order.status === 'NEW' ? { status: 'CONFIRMED' } : {}),
        ...(quote.kind === 'EXTRA' ? { total: snapshot.afterTotal, items: { create: snapshot.items } } : {}),
      } });
      await tx.orderQuote.update({ where: { id: quote.id }, data: { acceptedAt: now } });
      const actor = { id: quote.id, organizationId: quote.organizationId, name: 'Клиент по ссылке' };
      await this.audit.record(tx, actor, 'ORDER', quote.orderId, 'ORDER_QUOTE_ACCEPTED', {
        number: quote.order.number, quoteId: quote.id, revision: quote.revision, kind: quote.kind,
        beforeTotal: snapshot.beforeTotal, total: snapshot.afterTotal,
        ...(quote.kind === 'BASE' && quote.order.status === 'NEW' ? { from: 'NEW', to: 'CONFIRMED' } : {}),
      });
      await publishQuoteNotifications(tx, { id: quote.id, organizationId: quote.organizationId, orderId: quote.orderId });
      return { acceptedAt: now };
    });
  }
}
