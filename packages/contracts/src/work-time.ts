import { z } from 'zod';
import type { PageResult, Stage } from './index';

export const workTimeStatuses = ['SUBMITTED', 'APPROVED', 'REJECTED', 'VOIDED'] as const;
export type WorkTimeStatus = typeof workTimeStatuses[number];
export const workTimeStatusLabels: Record<WorkTimeStatus, string> = {
  SUBMITTED: 'Часы на проверке',
  APPROVED: 'Часы подтверждены',
  REJECTED: 'Часы отклонены',
  VOIDED: 'Запись аннулирована',
};
export const workTimeKinds = ['WORK', 'OVERTIME', 'ABSENCE'] as const;
export type WorkTimeKind = typeof workTimeKinds[number];
export const workTimeKindLabels: Record<WorkTimeKind, string> = {
  WORK: 'Обычная работа',
  OVERTIME: 'Сверхурочная работа',
  ABSENCE: 'Неотработанное время',
};

const uuid = z.uuid().transform(value => value.toLowerCase());
const instant = z.iso.datetime({ offset: true }).refine(value => {
  const ms = Date.parse(value);
  return ms >= Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) && ms % 60000 === 0;
});
export const workTimeEntrySchema = z.strictObject({
  startsAt: instant,
  endsAt: instant,
  kind: z.enum(workTimeKinds).optional(),
  employeeId: uuid.optional(),
  orderId: uuid.optional(),
  idempotencyKey: uuid,
}).refine(value => {
  const minutes = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 60000;
  return minutes >= 1 && minutes <= 1440;
});
export type WorkTimeEntryInput = z.infer<typeof workTimeEntrySchema>;

export const workTimeOrderSearch = z.strictObject({
  q: z.string().trim().max(150).refine(value => !value.includes('\u0000')).default(''),
});
const revision = z.number().int().min(0).max(2147483646);
export const workTimeAllocationSchema = z.strictObject({ orderId: uuid.nullable(), version: revision });
export const orderEffortPlanSchema = z.strictObject({
  minutes: z.number().int().min(1).max(60000),
  orderVersion: revision.min(1),
});
export const orderEffortFilter = workTimeOrderSearch.extend({ overrun: z.enum(['1']).optional() });
export const orderEffortQuery = orderEffortFilter.extend({
  page: z.string().regex(/^[1-9]\d{0,4}$/).transform(Number).default(1),
});
export type WorkTimeAllocationInput = z.infer<typeof workTimeAllocationSchema>;
export type OrderEffortPlan = z.infer<typeof orderEffortPlanSchema>;
export type OrderEffortFilter = z.infer<typeof orderEffortFilter>;

export interface WorkTimeOrder {
  id: string;
  number: number;
  title: string;
}
export interface OrderEffortTotals {
  actualMinutes: number;
  pendingMinutes: number;
  overtimeMinutes: number;
}
export interface OrderEffortRow extends WorkTimeOrder, OrderEffortTotals {
  status: Stage;
  plannedMinutes: number | null;
  deltaMinutes: number | null;
  orderVersion: number;
}
export interface OrderEffortDetail extends OrderEffortRow {
  contributors: (OrderEffortTotals & { employeeId: string; name: string })[];
}

export const workTimeMonthSchema = z.strictObject({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
});
export const workTimeQuerySchema = workTimeMonthSchema.extend({
  employeeId: uuid.optional(),
  status: z.enum(workTimeStatuses).optional(),
  page: z.string().regex(/^[1-9]\d{0,4}$/).transform(Number).default(1),
});
export type WorkTimeQuery = z.infer<typeof workTimeQuerySchema>;

export const workTimeDecisionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('APPROVED'),
    version: z.number().int().min(1).max(3),
  }),
  z.strictObject({
    status: z.enum(['REJECTED', 'VOIDED']),
    version: z.number().int().min(1).max(3),
    note: z.string().trim().min(1).max(300).refine(value => !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)),
  }),
]);
export type WorkTimeDecision = z.infer<typeof workTimeDecisionSchema>;

export interface WorkTimePerson {
  id: string;
  name: string;
  isActive: boolean;
}
export interface WorkTimeEntry {
  id: string;
  employee: Pick<WorkTimePerson, 'id' | 'name'>;
  startsAt: string;
  endsAt: string;
  kind: WorkTimeKind;
  status: WorkTimeStatus;
  decisionNote: string;
  version: number;
}
export interface WorkTimePage extends PageResult<WorkTimeEntry & {
  monthMinutes: number;
  nightMinutes: number;
  locked: boolean;
  order: WorkTimeOrder | null;
  allocationVersion: number;
}> {
  summary: {
    approvedMinutes: number;
    submittedMinutes: number;
    approvedOvertimeMinutes: number;
    approvedNightMinutes: number;
    approvedAbsenceMinutes: number;
  };
  period: { month: string; closedAt: string | null; ended: boolean };
}
