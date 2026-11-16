import { ConflictException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { csvText } from '../../common/csv';

export const workTimePeriod = (month: string) => Prisma.sql`
  SELECT (${month + '-01'}::date::timestamp AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC' AS "startsAt",
         ((${month + '-01'}::date + interval '1 month') AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC' AS "endsAt"`;

export function workTimeReport(organizationId: string, month: string, employeeId?: string, approvedOnly = false) {
  return Prisma.sql`
    WITH period AS (${workTimePeriod(month)}), clipped AS (
      SELECT w.id, w."employeeId", u.name AS "employeeName", w."startsAt", w."endsAt",
             w.kind, w.status, w."decisionNote", w.version,
             GREATEST(w."startsAt", p."startsAt") AS start_utc, LEAST(w."endsAt", p."endsAt") AS end_utc
      FROM "WorkTimeEntry" w
      JOIN "User" u ON u.id = w."employeeId" AND u."organizationId" = w."organizationId"
      CROSS JOIN period p
      WHERE w."organizationId" = ${organizationId}::uuid
        AND w."startsAt" >= p."startsAt" - interval '24 hours'
        AND w."startsAt" < p."endsAt" AND w."endsAt" > p."startsAt"
        ${employeeId ? Prisma.sql`AND w."employeeId" = ${employeeId}::uuid` : Prisma.empty}
        ${approvedOnly ? Prisma.sql`AND w.status = 'APPROVED'` : Prisma.empty}
    ), entries AS (
      SELECT c.*, (EXTRACT(EPOCH FROM (end_utc - start_utc)) / 60)::int AS minutes,
             CASE WHEN kind = 'ABSENCE' THEN 0 ELSE (
        SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(end_utc, ((night_day + interval '30 hours') AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC') -
          GREATEST(start_utc, ((night_day + interval '22 hours') AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'UTC')
        )))), 0)::int / 60
        FROM generate_series(
          ((start_utc AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Almaty')::date::timestamp - interval '1 day',
          ((end_utc AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Almaty')::date::timestamp,
          interval '1 day'
        ) AS nights(night_day)
      ) END AS "nightMinutes"
      FROM clipped c
    )`;
}

const maxRows = 10000;
export async function workTimeSnapshot(tx: Prisma.TransactionClient, organizationId: string, month: string) {
  const rows = await tx.$queryRaw<Array<{
    employeeId: string; employeeName: string; worked: bigint; overtime: bigint; night: bigint; absence: bigint;
  }>>(Prisma.sql`${workTimeReport(organizationId, month, undefined, true)}
    SELECT "employeeId", "employeeName",
           COALESCE(SUM(minutes) FILTER (WHERE kind <> 'ABSENCE'), 0) AS worked,
           COALESCE(SUM(minutes) FILTER (WHERE kind = 'OVERTIME'), 0) AS overtime,
           COALESCE(SUM("nightMinutes"), 0) AS night,
           COALESCE(SUM(minutes) FILTER (WHERE kind = 'ABSENCE'), 0) AS absence
    FROM entries GROUP BY "employeeId", "employeeName"
    ORDER BY "employeeName", "employeeId" LIMIT ${maxRows + 1}`);
  if (!rows.length) throw new ConflictException('В месяце нет подтверждённых записей');
  if (rows.length > maxRows) throw new PayloadTooLargeException('Табель превышает лимит выгрузки');
  const header = '\ufeffmonth,employee_id,employee_name,worked_minutes,overtime_minutes,night_minutes,absence_minutes\r\n';
  const csv = header + rows.map(row => [
    csvText(month), csvText(row.employeeId), csvText(row.employeeName),
    row.worked.toString(), row.overtime.toString(), row.night.toString(), row.absence.toString(),
  ].join(',')).join('\r\n') + '\r\n';
  if (Buffer.byteLength(csv, 'utf8') > 4 * 1024 * 1024) {
    throw new PayloadTooLargeException('Табель превышает лимит выгрузки');
  }
  return csv;
}
