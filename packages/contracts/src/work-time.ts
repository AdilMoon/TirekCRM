import { z } from 'zod';
import type { PageResult } from './index';

export const workTimeStatuses = ['SUBMITTED', 'APPROVED', 'REJECTED', 'VOIDED'] as const;
export type WorkTimeStatus = typeof workTimeStatuses[number];
export const workTimeStatusLabels: Record<WorkTimeStatus, string> = {
  SUBMITTED: 'Часы на проверке',
  APPROVED: 'Часы подтверждены',
  REJECTED: 'Часы отклонены',
  VOIDED: 'Запись аннулирована',
};

const uuid = z.uuid().transform(value => value.toLowerCase());
const instant = z.iso.datetime({ offset: true }).refine(value => {
  const ms = Date.parse(value);
  return ms >= Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) && ms % 60000 === 0;
});
export const workTimeEntrySchema = z.strictObject({
  startsAt: instant,
  endsAt: instant,
  employeeId: uuid.optional(),
  idempotencyKey: uuid,
}).refine(value => {
  const minutes = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 60000;
  return minutes >= 1 && minutes <= 1440;
});
export type WorkTimeEntryInput = z.infer<typeof workTimeEntrySchema>;

export const workTimeQuerySchema = z.strictObject({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
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
  status: WorkTimeStatus;
  decisionNote: string;
  version: number;
}
export interface WorkTimePage extends PageResult<WorkTimeEntry> {
  summary: { approvedMinutes: number; submittedMinutes: number };
}
