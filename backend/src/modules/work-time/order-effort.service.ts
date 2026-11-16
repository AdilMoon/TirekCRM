import { ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderEffortDetail, OrderEffortFilter, OrderEffortPlan, OrderEffortRow, PageResult } from '@tirek/contracts';
import type { AuthRequest } from '../../auth/session.guard';
import { csvText } from '../../common/csv';
import { serializable } from '../../common/transaction';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { orderTimeActiveEntries, orderTimeContributors, orderTimeTotalsSql, type OrderTimeTotals } from './order-time-totals';

type Actor = AuthRequest['user'];
type Totals = OrderTimeTotals;
type Summary = Omit<OrderEffortRow, keyof Totals | 'deltaMinutes'> & Totals;
const pageSize = 20;
const maxExportRows = 10000;
const planSelect = { id: true, number: true, title: true, status: true, plannedMinutes: true, version: true } as const;

const totals = (row: Totals) => ({
  actualMinutes: Number(row.actualMinutes),
  pendingMinutes: Number(row.pendingMinutes),
  overtimeMinutes: Number(row.overtimeMinutes),
});
const summary = (row: Summary): OrderEffortRow => ({
  id: row.id, number: row.number, title: row.title, status: row.status,
  plannedMinutes: row.plannedMinutes, orderVersion: row.orderVersion, ...totals(row),
  deltaMinutes: row.plannedMinutes !== null && row.actualMinutes > 0n ? Number(row.actualMinutes) - row.plannedMinutes : null,
});

@Injectable()
export class OrderEffortService {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  async detail(actor: Actor, id: string): Promise<OrderEffortDetail> {
    return this.db.client.$transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id, organizationId: actor.organizationId }, select: planSelect });
      if (!order) throw new NotFoundException('Заказ не найден');
      const contributors = await orderTimeContributors(tx, actor.organizationId, id);
      const combined = contributors.reduce((acc, row) => ({
        actualMinutes: acc.actualMinutes + row.actualMinutes,
        pendingMinutes: acc.pendingMinutes + row.pendingMinutes,
        overtimeMinutes: acc.overtimeMinutes + row.overtimeMinutes,
      }), { actualMinutes: 0n, pendingMinutes: 0n, overtimeMinutes: 0n });
      return {
        ...summary({ ...order, orderVersion: order.version, ...combined }),
        contributors: contributors.map(row => ({ employeeId: row.employeeId, name: row.name, ...totals(row) })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  savePlan(actor: Actor, id: string, input: OrderEffortPlan) {
    return serializable(this.db.client, async tx => {
      const owner = await tx.user.findFirst({
        where: { id: actor.id, organizationId: actor.organizationId, role: 'OWNER', isActive: true }, select: { id: true },
      });
      if (!owner) throw new ForbiddenException('Недостаточно прав');
      const order = await tx.order.findFirst({ where: { id, organizationId: actor.organizationId }, select: planSelect });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.plannedMinutes === input.minutes) return { orderVersion: order.version };
      if (order.version !== input.orderVersion) throw new ConflictException('Заказ изменился. Обновите данные');
      const updated = await tx.order.update({
        where: { id }, data: { plannedMinutes: input.minutes, version: { increment: 1 } }, select: { version: true },
      });
      await this.audit.record(tx, actor, 'ORDER', id, 'ORDER_EFFORT_PLAN_CHANGED', {
        previousMinutes: order.plannedMinutes, plannedMinutes: input.minutes,
      });
      return { orderVersion: updated.version };
    });
  }

  private report(organizationId: string, { q, overrun }: OrderEffortFilter) {
    const number = /^#?\s*\d{1,10}$/.test(q) ? Number(q.replace('#', '')) : 0;
    return Prisma.sql`
      WITH matching AS (
        SELECT id, number, title, status, version AS "orderVersion", "plannedMinutes"
        FROM "Order"
        WHERE "organizationId" = ${organizationId}::uuid
          ${q ? Prisma.sql`AND (strpos(lower(title), lower(${q}::text)) > 0 OR number = ${number}::bigint)` : Prisma.empty}
      ), measured AS (
        SELECT o.*, x.*
        FROM matching o
        LEFT JOIN LATERAL (
          SELECT ${orderTimeTotalsSql}
          FROM "WorkTimeAllocation" a
          JOIN "WorkTimeEntry" e ON e.id = a."entryId" AND e."organizationId" = a."organizationId"
          WHERE a."orderId" = o.id AND a."organizationId" = ${organizationId}::uuid AND ${orderTimeActiveEntries}
        ) x ON TRUE
      ), filtered AS (
        SELECT * FROM measured ${overrun ? Prisma.sql`WHERE "actualMinutes" > "plannedMinutes"` : Prisma.empty}
      )`;
  }

  async list(actor: Actor, query: OrderEffortFilter & { page: number }): Promise<PageResult<OrderEffortRow>> {
    const rows = await this.db.client.$queryRaw<Array<Summary & { total: bigint }>>(Prisma.sql`
      ${this.report(actor.organizationId, query)}, page_rows AS (
        SELECT * FROM filtered ORDER BY number DESC LIMIT ${pageSize} OFFSET ${(query.page - 1) * pageSize}
      )
      SELECT p.*, t.total FROM (SELECT count(*) AS total FROM filtered) t
      LEFT JOIN page_rows p ON TRUE ORDER BY p.number DESC`);
    const total = Number(rows[0].total);
    return { total, pages: Math.ceil(total / pageSize), page: query.page, pageSize, items: rows.filter(row => row.id).map(summary) };
  }

  async export(actor: Actor, query: OrderEffortFilter) {
    const rows = await this.db.client.$queryRaw<Summary[]>(Prisma.sql`
      ${this.report(actor.organizationId, query)}
      SELECT * FROM filtered ORDER BY number DESC LIMIT ${maxExportRows + 1}`);
    if (rows.length > maxExportRows) throw new PayloadTooLargeException('Отчёт превышает лимит выгрузки');
    const header = '\ufefforder_number,title,status,planned_minutes,actual_minutes,pending_minutes,overtime_minutes,delta_minutes';
    const csv = [header, ...rows.map(summary).map(row => [
      row.number, csvText(row.title), row.status, row.plannedMinutes, row.actualMinutes,
      row.pendingMinutes, row.overtimeMinutes, row.deltaMinutes,
    ].join(','))].join('\r\n') + '\r\n';
    if (Buffer.byteLength(csv, 'utf8') > 4 * 1024 * 1024) throw new PayloadTooLargeException('Отчёт превышает лимит выгрузки');
    return csv;
  }
}
