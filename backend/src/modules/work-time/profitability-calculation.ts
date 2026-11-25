import {Prisma} from '@prisma/client';
import type {OrderCostColumn,OrderProfitability} from '@tirek/contracts';
import {cents,money} from '../../common/money';
import type {OrderTimeTotals} from './order-time-totals';

export const select = {
  id: true, number: true, title: true, repeatOfId: true, costVersion: true, total: true, status: true, plannedMinutes: true,
  plannedHourlyRate: true, plannedDirectExpenses: true, actualHourlyRate: true,
} as const;
export type OrderInputs = Prisma.OrderGetPayload<{ select: typeof select }>;
export const amounts = (order: OrderInputs) => ({
  plannedHourlyRate: order.plannedHourlyRate?.toFixed(2) ?? null,
  plannedDirectExpenses: order.plannedDirectExpenses?.toFixed(2) ?? null,
  actualHourlyRate: order.actualHourlyRate?.toFixed(2) ?? null,
});
const asMoney = (value: bigint | null) => value === null ? null : money(value);

function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) return -roundedDivide(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

function costColumn(revenue: bigint, labor: bigint | null, expenses: bigint | null, rework: bigint | null = 0n): OrderCostColumn {
  const cost = labor === null || expenses === null || rework === null ? null : labor + expenses + rework;
  const profit = cost === null ? null : revenue - cost;
  return {
    rework: asMoney(rework), labor: asMoney(labor), expenses: asMoney(expenses), cost: asMoney(cost), profit: asMoney(profit),
    marginPercent: revenue > 0n && profit !== null ? money(roundedDivide(profit * 10000n, revenue)) : null,
  };
}


export function calculateProfitability(order:OrderInputs,
  time:(OrderTimeTotals & {employeeId:string;name:string})[],
  rates:{employeeId:string;hourlyRate:Prisma.Decimal}[],
  expenseCents:bigint,materialCents:bigint,
  visits:{result:OrderProfitability;reason:string}[]):OrderProfitability {
  const id=order.id;
  const visitCosts=visits.map(visit=>visit.result);
  const sumCosts=(values:(string|null)[])=>values.some(value=>value===null)?null:
    values.reduce<bigint>((sum,value)=>sum+BigInt(value!.replace('.','')),0n);
  const actualRework=sumCosts(visitCosts.map(visit=>visit.actual.cost));
  const forecastRework=sumCosts(visitCosts.map(visit=>visit.forecast.atCompletion.cost));
  const budget = amounts(order);
  const byEmployee = new Map(rates.map(rate => [rate.employeeId, rate.hourlyRate.toFixed(2)]));
  const contributors = time.filter(row => row.actualMinutes > 0n).map(row => ({
    employeeId: row.employeeId, name: row.name, minutes: row.actualMinutes,
    hourlyRate: byEmployee.get(row.employeeId) ?? null,
  }));
  const pendingMinutes = time.reduce((total, row) => total + row.pendingMinutes, 0n);
  const actualMinutes = contributors.reduce((total, row) => total + row.minutes, 0n);
  let actualLabor: bigint | null = 0n;
  for (const row of contributors) {
    const rate = row.hourlyRate ?? budget.actualHourlyRate;
    if (rate === null) {
      actualLabor = null;
      break;
    }
    actualLabor += row.minutes * cents(rate);
  }
  const plannedRate = budget.plannedHourlyRate === null ? null : cents(budget.plannedHourlyRate);
  const plannedLabor = plannedRate === 0n ? 0n : plannedRate === null || order.plannedMinutes === null
    ? null : roundedDivide(plannedRate * BigInt(order.plannedMinutes), 60n);
  const revenue = cents(order.total.toFixed(2));
  const actualRevenue = order.status === 'CANCELLED' ? 0n : revenue;
  const closed = order.status === 'COMPLETED' || order.status === 'CANCELLED';
  const remainingRate = budget.actualHourlyRate ?? budget.plannedHourlyRate;
  const remainingMinutes = closed ? 0 : order.plannedMinutes === null ? null :
    Math.max(0, order.plannedMinutes - Number(actualMinutes + pendingMinutes));
  const incurredExpenses = expenseCents + materialCents;
  const expenseBudget = budget.plannedDirectExpenses === null ? null : cents(budget.plannedDirectExpenses);
  const remainingExpenses = closed ? 0n : expenseBudget === null ? null :
    expenseBudget > incurredExpenses ? expenseBudget - incurredExpenses : 0n;

  // Accumulate minute × rate for all stages before rounding once to the nearest tiyn.
  let forecastLabor = actualLabor;
  for (const row of time) {
    if (row.pendingMinutes === 0n || forecastLabor === null) continue;
    const rate = byEmployee.get(row.employeeId) ?? remainingRate;
    forecastLabor = rate === null ? null : forecastLabor + row.pendingMinutes * cents(rate);
  }
  if (forecastLabor !== null && remainingMinutes !== 0 && remainingRate !== '0.00') {
    forecastLabor = remainingMinutes === null || remainingRate === null ? null :
      forecastLabor + BigInt(remainingMinutes) * cents(remainingRate);
  }
  return {
    repeatOfId:order.repeatOfId,status:order.status,
    repeatVisits:visitCosts.map((visit,index)=>({id:visit.id,number:visit.number,title:visit.title,status:visit.status,
      reason:visits[index].reason,actualCost:visit.actual.cost,forecastCost:visit.forecast.atCompletion.cost})),
    id, number: order.number, title: order.title, costVersion: order.costVersion, revenue: money(revenue),
    actualRevenue: money(actualRevenue),
    plannedMinutes: order.plannedMinutes, actualMinutes: Number(actualMinutes), pendingMinutes: Number(pendingMinutes), ...budget,
    planned: costColumn(revenue, plannedLabor, expenseBudget),
    actual: costColumn(actualRevenue, actualLabor === null ? null : roundedDivide(actualLabor, 60n), incurredExpenses,actualRework),
    forecast: {
      atCompletion: costColumn(actualRevenue, forecastLabor === null ? null : roundedDivide(forecastLabor, 60n),
        remainingExpenses === null ? null : incurredExpenses + remainingExpenses,forecastRework),
      remainingMinutes, remainingHourlyRate: remainingRate, remainingExpenses: asMoney(remainingExpenses), closed:closed&&visitCosts.every(visit=>visit.forecast.closed),
    },
    contributors: contributors.map(({ minutes, ...row }) => ({ ...row, approvedMinutes: Number(minutes) })),
  };
}
