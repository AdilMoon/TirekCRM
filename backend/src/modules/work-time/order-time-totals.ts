import { Prisma } from '@prisma/client';

export type OrderTimeTotals = { actualMinutes: bigint; pendingMinutes: bigint; overtimeMinutes: bigint };
const duration = Prisma.sql`(EXTRACT(EPOCH FROM (e."endsAt" - e."startsAt")) / 60)::int`;
export const orderTimeTotalsSql = Prisma.sql`
  COALESCE(SUM(${duration}) FILTER (WHERE e.status = 'APPROVED'), 0) AS "actualMinutes",
  COALESCE(SUM(${duration}) FILTER (WHERE e.status = 'SUBMITTED'), 0) AS "pendingMinutes",
  COALESCE(SUM(${duration}) FILTER (WHERE e.status = 'APPROVED' AND e.kind = 'OVERTIME'), 0) AS "overtimeMinutes"`;
export const orderTimeActiveEntries = Prisma.sql`e.kind <> 'ABSENCE' AND e.status IN ('APPROVED', 'SUBMITTED')`;

export function orderTimeContributors(tx: Prisma.TransactionClient, organizationId: string, orderId: string) {
  return tx.$queryRaw<Array<OrderTimeTotals & { employeeId: string; name: string }>>(Prisma.sql`
    SELECT u.id AS "employeeId", u.name, ${orderTimeTotalsSql}
    FROM "WorkTimeAllocation" a
    JOIN "WorkTimeEntry" e ON e.id = a."entryId" AND e."organizationId" = a."organizationId"
    JOIN "User" u ON u.id = e."employeeId" AND u."organizationId" = e."organizationId"
    WHERE a."orderId" = ${orderId}::uuid AND a."organizationId" = ${organizationId}::uuid AND ${orderTimeActiveEntries}
    GROUP BY u.id, u.name ORDER BY "actualMinutes" DESC, u.name, u.id`);
}
