import { z } from 'zod';

const amount = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).nullable();
const rateChange = z.strictObject({
  employeeId: z.uuid().transform(value => value.toLowerCase()),
  hourlyRate: amount,
});

export const orderProfitabilitySchema = z.strictObject({
  costVersion: z.number().int().min(1).max(2147483646),
  plannedHourlyRate: amount,
  plannedDirectExpenses: amount,
  actualHourlyRate: amount,
  rates: z.array(rateChange).max(200).refine(rows => new Set(rows.map(row => row.employeeId)).size === rows.length),
});
export type OrderProfitabilityInput = z.infer<typeof orderProfitabilitySchema>;

export interface OrderCostColumn {
  rework: string | null;
  labor: string | null;
  expenses: string | null;
  cost: string | null;
  profit: string | null;
  marginPercent: string | null;
}

export interface OrderProfitability {
  status: string;
  repeatOfId: string | null;
  repeatVisits: {id:string;number:number;title:string;status:string;reason:string;actualCost:string|null;forecastCost:string|null}[];
  id: string;
  number: number;
  title: string;
  costVersion: number;
  revenue: string;
  actualRevenue: string;
  plannedMinutes: number | null;
  actualMinutes: number;
  pendingMinutes: number;
  plannedHourlyRate: string | null;
  plannedDirectExpenses: string | null;
  actualHourlyRate: string | null;
  planned: OrderCostColumn;
  actual: OrderCostColumn;
  forecast: {
    atCompletion: OrderCostColumn;
    remainingMinutes: number | null;
    remainingHourlyRate: string | null;
    remainingExpenses: string | null;
    closed: boolean;
  };
  contributors: {
    employeeId: string;
    name: string;
    approvedMinutes: number;
    hourlyRate: string | null;
  }[];
}
