import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WorkTimeAllocationInput, WorkTimeDecision, WorkTimeEntryInput, WorkTimePage, WorkTimeQuery } from '@tirek/contracts';
import type { AuthRequest } from '../../auth/session.guard';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { workTimePeriod, workTimeReport, workTimeSnapshot } from './work-time-report';

type Actor = AuthRequest['user'];
const pageSize = 20;
const orderSelect = { id: true, number: true, title: true } as const;
const select = {
  id: true, employee: { select: { id: true, name: true } }, startsAt: true, endsAt: true, kind: true,
  status: true, decisionNote: true, version: true,
} as const;
const overlap = () => new ConflictException('Интервал пересекается с другой записью табеля');
const stale = () => new ConflictException('Запись табеля изменилась. Обновите список');

@Injectable()
export class WorkTimeService {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  people(actor: Actor) {
    return this.db.client.user.findMany({
      where: { organizationId: actor.organizationId, role: 'EMPLOYEE' },
      select: { id: true, name: true, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  orders(actor: Actor, q: string) {
    const number = /^#?\s*\d{1,10}$/.test(q) ? Number(q.replace('#', '')) : 0;
    return this.db.client.order.findMany({
      where: {
        ...this.eligibleOrders(actor),
        ...(q ? { OR: [
          { title: { contains: q.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } },
          ...(number > 0 && number <= 2147483647 ? [{ number }] : []),
        ] } : {}),
      },
      select: orderSelect, orderBy: { number: 'desc' }, take: 30,
    });
  }

  private eligibleOrders(actor: Actor): Prisma.OrderWhereInput {
    return {
      organizationId: actor.organizationId,
      status: { not: 'CANCELLED' },
      ...(actor.role === 'EMPLOYEE' ? {
        tasks: { some: { organizationId: actor.organizationId, assigneeId: actor.id, status: { not: 'CANCELLED' } } },
      } : {}),
    };
  }

  private async checkOrder(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    if (!await tx.order.findFirst({ where: { ...this.eligibleOrders(actor), id }, select: { id: true } })) {
      throw new NotFoundException('Заказ недоступен для учёта времени');
    }
  }

  async list(actor: Actor, query: WorkTimeQuery): Promise<WorkTimePage> {
    if (actor.role === 'EMPLOYEE' && query.employeeId) throw new ForbiddenException('Недостаточно прав');
    const employeeId = actor.role === 'EMPLOYEE' ? actor.id : query.employeeId;
    const rows = await this.db.client.$queryRaw<Array<{
      id: string | null;
      employeeId: string;
      employeeName: string;
      startsAt: Date;
      endsAt: Date;
      status: WorkTimePage['items'][number]['status'];
      kind: WorkTimePage['items'][number]['kind'];
      decisionNote: string;
      version: number;
      minutes: number;
      nightMinutes: number;
      locked: boolean;
      orderId: string | null;
      orderNumber: number;
      orderTitle: string;
      allocationVersion: number | null;
      approvedMinutes: bigint;
      submittedMinutes: bigint;
      approvedOvertimeMinutes: bigint;
      approvedNightMinutes: bigint;
      approvedAbsenceMinutes: bigint;
      closedAt: Date | null;
      ended: boolean;
      total: bigint;
    }>>(Prisma.sql`
      ${workTimeReport(actor.organizationId, query.month, employeeId)}, totals AS (
        SELECT COALESCE(SUM(minutes) FILTER (WHERE status='APPROVED' AND kind <> 'ABSENCE'), 0) AS "approvedMinutes",
               COALESCE(SUM(minutes) FILTER (WHERE status='SUBMITTED' AND kind <> 'ABSENCE'), 0) AS "submittedMinutes",
               COALESCE(SUM(minutes) FILTER (WHERE status='APPROVED' AND kind = 'OVERTIME'), 0) AS "approvedOvertimeMinutes",
               COALESCE(SUM("nightMinutes") FILTER (WHERE status='APPROVED'), 0) AS "approvedNightMinutes",
               COALESCE(SUM(minutes) FILTER (WHERE status='APPROVED' AND kind = 'ABSENCE'), 0) AS "approvedAbsenceMinutes"
        FROM entries
      ), filtered AS (
        SELECT * FROM entries ${query.status ? Prisma.sql`WHERE status=${query.status}::"WorkTimeStatus"` : Prisma.empty}
      ), page_rows AS (
        SELECT * FROM filtered ORDER BY "startsAt" DESC, "id" DESC
        LIMIT ${pageSize} OFFSET ${(query.page - 1) * pageSize}
      )
      SELECT p.*, t.*, m."closedAt", period."endsAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS ended,
             o.id AS "orderId", o.number AS "orderNumber", o.title AS "orderTitle", a.version AS "allocationVersion",
             EXISTS (SELECT 1 FROM "WorkTimeMonth" closed
               WHERE closed."organizationId" = ${actor.organizationId}::uuid
                 AND closed."startsAt" < p."endsAt" AND closed."endsAt" > p."startsAt") AS locked,
             (SELECT COUNT(*) FROM filtered) AS total
      FROM totals t CROSS JOIN period
      LEFT JOIN page_rows p ON TRUE
      LEFT JOIN "WorkTimeAllocation" a ON a."entryId" = p.id AND a."organizationId" = ${actor.organizationId}::uuid
      LEFT JOIN "Order" o ON o.id = a."orderId" AND o."organizationId" = a."organizationId"
        ${actor.role === 'EMPLOYEE' ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "BusinessTask" task
          WHERE task."organizationId" = o."organizationId" AND task."orderId" = o.id
            AND task."assigneeId" = ${actor.id}::uuid AND task.status <> 'CANCELLED'
        )` : Prisma.empty}
      LEFT JOIN "WorkTimeMonth" m ON m."organizationId" = ${actor.organizationId}::uuid AND m.month = ${query.month}
      ORDER BY p."startsAt" DESC, p."id" DESC`);
    const totals = rows[0];
    return {
      items: rows.flatMap(row => row.id ? [{
        id: row.id,
        employee: { id: row.employeeId, name: row.employeeName },
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        kind: row.kind,
        monthMinutes: row.minutes,
        nightMinutes: row.nightMinutes,
        locked: row.locked,
        status: row.status,
        decisionNote: row.decisionNote,
        version: row.version,
        order: row.orderId ? { id: row.orderId, number: row.orderNumber, title: row.orderTitle } : null,
        allocationVersion: row.allocationVersion ?? 0,
      }] : []),
      total: Number(totals.total),
      pages: Math.ceil(Number(totals.total) / pageSize),
      page: query.page,
      pageSize,
      summary: {
        approvedMinutes: Number(totals.approvedMinutes),
        submittedMinutes: Number(totals.submittedMinutes),
        approvedOvertimeMinutes: Number(totals.approvedOvertimeMinutes),
        approvedNightMinutes: Number(totals.approvedNightMinutes),
        approvedAbsenceMinutes: Number(totals.approvedAbsenceMinutes),
      },
      period: { month: query.month, closedAt: totals.closedAt?.toISOString() ?? null, ended: totals.ended },
    };
  }

  private async checkActor(tx: Prisma.TransactionClient, actor: Actor) {
    const active = await tx.user.findFirst({
      where: { id: actor.id, organizationId: actor.organizationId, role: actor.role, isActive: true },
      select: { id: true },
    });
    if (!active) throw new ForbiddenException('Недостаточно прав');
  }

  private write<T>(actor: Actor, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.client.$transaction(async tx => {
      // Each mutation takes the same per-company lock before reading periods and entries.
      // ReadCommitted gives queries after the lock the state committed by its previous holder.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'work-time:' + actor.organizationId}::text, 0))`;
      await this.checkActor(tx, actor);
      return operation(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
  }

  private async checkOpen(tx: Prisma.TransactionClient, organizationId: string, startsAt: Date, endsAt: Date) {
    const closed = await tx.workTimeMonth.findFirst({
      where: { organizationId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { month: true },
    });
    if (closed) throw new ConflictException('Интервал затрагивает закрытый месяц');
  }

  async create(actor: Actor, input: WorkTimeEntryInput) {
    const owner = actor.role === 'OWNER';
    if (!owner && input.employeeId) throw new ForbiddenException('Недостаточно прав');
    if (owner && !input.employeeId) throw new BadRequestException('Выберите сотрудника');
    const employeeId = input.employeeId ?? actor.id;
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const kind = input.kind ?? 'WORK';
    const orderId = input.orderId ?? null;
    if (orderId && kind === 'ABSENCE') throw new BadRequestException('Неотработанное время нельзя привязать к заказу');
    const key = { organizationId: actor.organizationId, createdById: actor.id, idempotencyKey: input.idempotencyKey };
    const findReplay = async (tx: Prisma.TransactionClient) => {
      const entry = await tx.workTimeEntry.findUnique({
        where: { organizationId_createdById_idempotencyKey: key }, select: { ...select, submittedOrderId: true },
      });
      if (!entry) return null;
      const { submittedOrderId, ...result } = entry;
      if (entry.employee.id !== employeeId || +entry.startsAt !== +startsAt || +entry.endsAt !== +endsAt ||
          entry.kind !== kind || submittedOrderId !== orderId) {
        throw new ConflictException('Ключ операции уже использован');
      }
      return result;
    };
    try {
      return await this.write(actor, async tx => {
        const replay = await findReplay(tx);
        if (replay) return replay;
        await this.checkOpen(tx, actor.organizationId, startsAt, endsAt);
        if (endsAt.getTime() > Date.now()) throw new BadRequestException('Нельзя записать рабочее время в будущем');
        const employee = await tx.user.findFirst({
          where: { id: employeeId, organizationId: actor.organizationId, role: 'EMPLOYEE', isActive: true },
          select: { id: true },
        });
        if (!employee) throw new NotFoundException('Активный исполнитель не найден');
        if (orderId) await this.checkOrder(tx, actor, orderId);
        const collision = await tx.workTimeEntry.findFirst({
          where: {
            organizationId: actor.organizationId, employeeId,
            startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
            status: { in: ['SUBMITTED', 'APPROVED'] },
          },
          select: { id: true },
        });
        if (collision) throw overlap();
        const entry = await tx.workTimeEntry.create({
          data: { ...key, employeeId, startsAt, endsAt, kind, submittedOrderId: orderId, createdAt: new Date() }, select,
        });
        if (orderId) await tx.workTimeAllocation.create({ data: { entryId: entry.id, organizationId: actor.organizationId, orderId } });
        await this.audit.record(tx, actor, 'WORK_TIME', entry.id, 'WORK_TIME_SUBMITTED', { employeeId, kind, orderId });
        return entry;
      });
    } catch (error) {
      // Prisma maps a PostgreSQL exclusion constraint from the concurrent insert to P2004.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') &&
          !(error instanceof Error && error.message.includes('WorkTimeEntry_no_overlap'))) throw error;
      return this.write(actor, async tx => {
        const replay = await findReplay(tx);
        if (replay) return replay;
        throw overlap();
      });
    }
  }

  allocate(actor: Actor, id: string, input: WorkTimeAllocationInput) {
    this.requireOwner(actor);
    return this.write(actor, async tx => {
      const entry = await tx.workTimeEntry.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: { kind: true, status: true, allocation: { select: { orderId: true, version: true } } },
      });
      if (!entry) throw new NotFoundException('Запись табеля не найдена');
      if (entry.kind === 'ABSENCE' || !['SUBMITTED', 'APPROVED'].includes(entry.status)) {
        throw new ConflictException('К заказу можно привязать рабочие часы на проверке или подтверждённые часы');
      }
      const version = entry.allocation?.version ?? 0;
      const previousOrderId = entry.allocation?.orderId ?? null;
      if (input.orderId === previousOrderId && (version === input.version || version === input.version + 1)) return { version };
      if (version !== input.version) throw stale();
      if (input.orderId) await this.checkOrder(tx, actor, input.orderId);
      // Only the analytical allocation changes, including for a closed payroll period.
      const allocation = await tx.workTimeAllocation.upsert({
        where: { entryId: id },
        create: { entryId: id, organizationId: actor.organizationId, orderId: input.orderId },
        update: { orderId: input.orderId, version: { increment: 1 } },
        select: { version: true },
      });
      await this.audit.record(tx, actor, 'WORK_TIME', id, 'WORK_TIME_ORDER_CHANGED', {
        previousOrderId, orderId: input.orderId,
      });
      return allocation;
    });
  }

  decide(actor: Actor, id: string, input: WorkTimeDecision) {
    if (actor.role !== 'OWNER') throw new ForbiddenException('Недостаточно прав');
    return this.write(actor, async tx => {
      const entry = await tx.workTimeEntry.findFirst({ where: { id, organizationId: actor.organizationId }, select });
      if (!entry) throw new NotFoundException('Запись табеля не найдена');
      const decisionNote = input.status === 'APPROVED' ? '' : input.note;
      if (entry.version === input.version + 1 && entry.status === input.status && entry.decisionNote === decisionNote) return entry;
      await this.checkOpen(tx, actor.organizationId, entry.startsAt, entry.endsAt);
      if (entry.version !== input.version) throw stale();
      const expected = input.status === 'VOIDED' ? 'APPROVED' : 'SUBMITTED';
      if (entry.status !== expected) throw stale();
      const updated = await tx.workTimeEntry.update({
        where: { id }, data: { status: input.status, decisionNote, version: { increment: 1 } }, select,
      });
      await this.audit.record(tx, actor, 'WORK_TIME', id, 'WORK_TIME_REVIEWED', {
        employeeId: entry.employee.id, from: entry.status, to: input.status,
      });
      return updated;
    });
  }

  closeMonth(actor: Actor, month: string) {
    this.requireOwner(actor);
    return this.write(actor, async tx => {
      const key = { organizationId: actor.organizationId, month };
      const existing = await tx.workTimeMonth.findUnique({
        where: { organizationId_month: key }, select: { closedAt: true },
      });
      if (existing) return existing;
      const [period] = await tx.$queryRaw<Array<{ startsAt: Date; endsAt: Date }>>(workTimePeriod(month));
      if (+period.endsAt > Date.now()) throw new ConflictException('Месяц ещё не закончился');
      const pending = await tx.workTimeEntry.findFirst({
        where: {
          organizationId: actor.organizationId, status: 'SUBMITTED',
          startsAt: { lt: period.endsAt, gte: new Date(+period.startsAt - 86400000) }, endsAt: { gt: period.startsAt },
        },
        select: { id: true },
      });
      if (pending) throw new ConflictException('Сначала проверьте все записи за месяц');
      const csv = await workTimeSnapshot(tx, actor.organizationId, month);
      const result = await tx.workTimeMonth.create({
        data: { ...key, ...period, closedAt: new Date(), closedById: actor.id, csv },
        select: { closedAt: true },
      });
      await this.audit.record(tx, actor, 'WORK_TIME', actor.organizationId, 'WORK_TIME_MONTH_CLOSED', { month });
      return result;
    });
  }

  async exportMonth(actor: Actor, month: string) {
    this.requireOwner(actor);
    const snapshot = await this.db.client.workTimeMonth.findUnique({
      where: { organizationId_month: { organizationId: actor.organizationId, month } }, select: { csv: true },
    });
    if (!snapshot) throw new ConflictException('Сначала закройте месяц');
    return snapshot.csv;
  }

  private requireOwner(actor: Actor) {
    if (actor.role !== 'OWNER') throw new ForbiddenException('Недостаточно прав');
  }
}
