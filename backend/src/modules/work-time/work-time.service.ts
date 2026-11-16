import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WorkTimeDecision, WorkTimeEntryInput, WorkTimePage, WorkTimeQuery } from '@tirek/contracts';
import type { AuthRequest } from '../../auth/session.guard';
import { serializable } from '../../common/transaction';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';

type Actor = AuthRequest['user'];
const pageSize = 20;
const select = {
  id: true, employee: { select: { id: true, name: true } }, startsAt: true, endsAt: true,
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
      decisionNote: string;
      version: number;
      approvedMinutes: bigint;
      submittedMinutes: bigint;
      total: bigint;
    }>>(Prisma.sql`
      WITH period AS (
        SELECT (${query.month + '-01'}::date::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC' AS "from",
               ((${query.month + '-01'}::date + interval '1 month') AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC' AS "to"
      ), entries AS (
        SELECT w."id", w."employeeId", u."name" AS "employeeName", w."startsAt", w."endsAt",
               w."status", w."decisionNote", w."version",
               EXTRACT(EPOCH FROM (LEAST(w."endsAt", p."to") - GREATEST(w."startsAt", p."from"))) / 60 AS minutes
        FROM "WorkTimeEntry" w
        JOIN "User" u ON u."id"=w."employeeId" AND u."organizationId"=w."organizationId"
        CROSS JOIN period p
        WHERE w."organizationId"=${actor.organizationId}::uuid
          AND w."startsAt" >= p."from" - interval '24 hours'
          AND w."startsAt" < p."to" AND w."endsAt" > p."from"
          ${employeeId ? Prisma.sql`AND w."employeeId"=${employeeId}::uuid` : Prisma.empty}
      ), totals AS (
        SELECT COALESCE(SUM(minutes) FILTER (WHERE status='APPROVED'), 0)::bigint AS "approvedMinutes",
               COALESCE(SUM(minutes) FILTER (WHERE status='SUBMITTED'), 0)::bigint AS "submittedMinutes"
        FROM entries
      ), filtered AS (
        SELECT * FROM entries ${query.status ? Prisma.sql`WHERE status=${query.status}::"WorkTimeStatus"` : Prisma.empty}
      ), page_rows AS (
        SELECT * FROM filtered ORDER BY "startsAt" DESC, "id" DESC
        LIMIT ${pageSize} OFFSET ${(query.page - 1) * pageSize}
      )
      SELECT p.*, t.*, (SELECT COUNT(*) FROM filtered) AS total
      FROM totals t LEFT JOIN page_rows p ON TRUE
      ORDER BY p."startsAt" DESC, p."id" DESC`);
    const { total, approvedMinutes, submittedMinutes } = rows[0];
    return {
      items: rows.flatMap(row => row.id ? [{
        id: row.id,
        employee: { id: row.employeeId, name: row.employeeName },
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        status: row.status,
        decisionNote: row.decisionNote,
        version: row.version,
      }] : []),
      total: Number(total),
      pages: Math.ceil(Number(total) / pageSize),
      page: query.page,
      pageSize,
      summary: { approvedMinutes: Number(approvedMinutes), submittedMinutes: Number(submittedMinutes) },
    };
  }

  private async checkActor(tx: Prisma.TransactionClient, actor: Actor) {
    const active = await tx.user.findFirst({
      where: { id: actor.id, organizationId: actor.organizationId, role: actor.role, isActive: true },
      select: { id: true },
    });
    if (!active) throw new ForbiddenException('Недостаточно прав');
  }

  async create(actor: Actor, input: WorkTimeEntryInput) {
    const owner = actor.role === 'OWNER';
    if (!owner && input.employeeId) throw new ForbiddenException('Недостаточно прав');
    if (owner && !input.employeeId) throw new BadRequestException('Выберите сотрудника');
    const employeeId = input.employeeId ?? actor.id;
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const key = { organizationId: actor.organizationId, createdById: actor.id, idempotencyKey: input.idempotencyKey };
    const findReplay = async (tx: Prisma.TransactionClient) => {
      const entry = await tx.workTimeEntry.findUnique({
        where: { organizationId_createdById_idempotencyKey: key }, select,
      });
      if (entry && (entry.employee.id !== employeeId || +entry.startsAt !== +startsAt || +entry.endsAt !== +endsAt)) {
        throw new ConflictException('Ключ операции уже использован');
      }
      return entry;
    };
    try {
      return await serializable(this.db.client, async tx => {
        await this.checkActor(tx, actor);
        const replay = await findReplay(tx);
        if (replay) return replay;
        if (endsAt.getTime() > Date.now()) throw new BadRequestException('Нельзя записать рабочее время в будущем');
        const employee = await tx.user.findFirst({
          where: { id: employeeId, organizationId: actor.organizationId, role: 'EMPLOYEE', isActive: true },
          select: { id: true },
        });
        if (!employee) throw new NotFoundException('Активный исполнитель не найден');
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
          data: { ...key, employeeId, startsAt, endsAt, createdAt: new Date() }, select,
        });
        await this.audit.record(tx, actor, 'WORK_TIME', entry.id, 'WORK_TIME_SUBMITTED', { employeeId });
        return entry;
      });
    } catch (error) {
      // Prisma maps a PostgreSQL exclusion constraint from the concurrent insert to P2004.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') &&
          !(error instanceof Error && error.message.includes('WorkTimeEntry_no_overlap'))) throw error;
      return serializable(this.db.client, async tx => {
        await this.checkActor(tx, actor);
        const replay = await findReplay(tx);
        if (replay) return replay;
        throw overlap();
      });
    }
  }

  decide(actor: Actor, id: string, input: WorkTimeDecision) {
    if (actor.role !== 'OWNER') throw new ForbiddenException('Недостаточно прав');
    return serializable(this.db.client, async tx => {
      await this.checkActor(tx, actor);
      const entry = await tx.workTimeEntry.findFirst({ where: { id, organizationId: actor.organizationId }, select });
      if (!entry) throw new NotFoundException('Запись табеля не найдена');
      const decisionNote = input.status === 'APPROVED' ? '' : input.note;
      if (entry.version === input.version + 1 && entry.status === input.status && entry.decisionNote === decisionNote) return entry;
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
}
