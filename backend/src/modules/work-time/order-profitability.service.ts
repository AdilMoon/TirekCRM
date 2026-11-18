import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderCostColumn, OrderProfitability, OrderProfitabilityInput } from '@tirek/contracts';
import type { AuthRequest } from '../../auth/session.guard';
import { cents, money } from '../../common/money';
import { serializable } from '../../common/transaction';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { orderTimeContributors } from './order-time-totals';

type Actor = AuthRequest['user'];
const select = {
  id: true, number: true, title: true, costVersion: true, total: true, status: true, plannedMinutes: true,
  plannedHourlyRate: true, plannedDirectExpenses: true, actualHourlyRate: true,
} as const;
type OrderInputs = Prisma.OrderGetPayload<{ select: typeof select }>;
const amounts = (order: OrderInputs) => ({
  plannedHourlyRate: order.plannedHourlyRate?.toFixed(2) ?? null,
  plannedDirectExpenses: order.plannedDirectExpenses?.toFixed(2) ?? null,
  actualHourlyRate: order.actualHourlyRate?.toFixed(2) ?? null,
});
const normalize = (value: string | null) => value === null ? null : money(cents(value));
const asMoney = (value: bigint | null) => value === null ? null : money(value);

function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) return -roundedDivide(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

function costColumn(revenue: bigint, labor: bigint | null, expenses: bigint | null): OrderCostColumn {
  const cost = labor === null || expenses === null ? null : labor + expenses;
  const profit = cost === null ? null : revenue - cost;
  return {
    labor: asMoney(labor), expenses: asMoney(expenses), cost: asMoney(cost), profit: asMoney(profit),
    marginPercent: revenue > 0n && profit !== null ? money(roundedDivide(profit * 10000n, revenue)) : null,
  };
}

@Injectable()
export class OrderProfitabilityService {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  private async order(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    const order = await tx.order.findFirst({ where: { id, organizationId: actor.organizationId }, select });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  detail(actor: Actor, id: string): Promise<OrderProfitability> {
    const organizationId = actor.organizationId;
    return this.db.client.$transaction(async tx => {
      const order = await this.order(tx, actor, id);
      const time = await orderTimeContributors(tx, organizationId, id);
      const rates = await tx.orderLaborRate.findMany({
        where: { orderId: id, organizationId }, select: { employeeId: true, hourlyRate: true },
      });
      // A replacement is a new expense. Its old expense is offset on its original order.
      const [expense] = await tx.$queryRaw<{ cents: string }[]>(Prisma.sql`
        SELECT COALESCE(SUM(((e.amount - COALESCE(r.amount, 0)) * 100)::bigint), 0)::text AS cents
        FROM "Expense" e LEFT JOIN "ExpenseReversal" r
          ON r."expenseId" = e.id AND r."organizationId" = e."organizationId"
        WHERE e."orderId" = ${id}::uuid AND e."organizationId" = ${organizationId}::uuid`);

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
      const incurredExpenses = BigInt(expense.cents);
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
        id, number: order.number, title: order.title, costVersion: order.costVersion, revenue: money(revenue),
        actualRevenue: money(actualRevenue),
        plannedMinutes: order.plannedMinutes, actualMinutes: Number(actualMinutes), pendingMinutes: Number(pendingMinutes), ...budget,
        planned: costColumn(revenue, plannedLabor, expenseBudget),
        actual: costColumn(actualRevenue, actualLabor === null ? null : roundedDivide(actualLabor, 60n), incurredExpenses),
        forecast: {
          atCompletion: costColumn(actualRevenue, forecastLabor === null ? null : roundedDivide(forecastLabor, 60n),
            remainingExpenses === null ? null : incurredExpenses + remainingExpenses),
          remainingMinutes, remainingHourlyRate: remainingRate, remainingExpenses: asMoney(remainingExpenses), closed,
        },
        contributors: contributors.map(({ minutes, ...row }) => ({ ...row, approvedMinutes: Number(minutes) })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  save(actor: Actor, id: string, input: OrderProfitabilityInput) {
    const organizationId = actor.organizationId;
    return serializable(this.db.client, async tx => {
      const owner = await tx.user.findFirst({
        where: { id: actor.id, organizationId, role: 'OWNER', isActive: true }, select: { id: true },
      });
      if (!owner) throw new ForbiddenException('Недостаточно прав');
      const order = await this.order(tx, actor, id);
      const prior = amounts(order);
      const next = {
        plannedHourlyRate: normalize(input.plannedHourlyRate),
        plannedDirectExpenses: normalize(input.plannedDirectExpenses),
        actualHourlyRate: normalize(input.actualHourlyRate),
      };
      const existing = input.rates.length ? await tx.orderLaborRate.findMany({
        where: { orderId: id, organizationId, employeeId: { in: input.rates.map(rate => rate.employeeId) } },
        select: { employeeId: true, hourlyRate: true },
      }) : [];
      const byEmployee = new Map(existing.map(rate => [rate.employeeId, rate.hourlyRate.toFixed(2)]));
      const changes = input.rates.map(rate => ({
        employeeId: rate.employeeId, previousRate: byEmployee.get(rate.employeeId) ?? null, hourlyRate: normalize(rate.hourlyRate),
      })).filter(rate => rate.previousRate !== rate.hourlyRate);
      if (!changes.length && next.plannedHourlyRate === prior.plannedHourlyRate &&
          next.plannedDirectExpenses === prior.plannedDirectExpenses && next.actualHourlyRate === prior.actualHourlyRate) {
        return { costVersion: order.costVersion };
      }
      if (order.costVersion !== input.costVersion) throw new ConflictException('Заказ изменился. Обновите данные');
      if (changes.some(rate => rate.hourlyRate !== null)) {
        const time = await orderTimeContributors(tx, organizationId, id);
        const approved = new Set(time.filter(row => row.actualMinutes > 0n).map(row => row.employeeId));
        if (changes.some(rate => rate.hourlyRate !== null && !approved.has(rate.employeeId))) {
          throw new NotFoundException('Сотрудник с подтверждёнными часами по заказу не найден');
        }
      }
      const updated = await tx.order.update({
        where: { id }, data: { ...next, costVersion: { increment: 1 } }, select: { costVersion: true },
      });
      for (const { employeeId, hourlyRate } of changes) {
        const where = { orderId_employeeId: { orderId: id, employeeId } };
        if (hourlyRate === null) await tx.orderLaborRate.delete({ where });
        else await tx.orderLaborRate.upsert({ where, create: { orderId: id, organizationId, employeeId, hourlyRate }, update: { hourlyRate } });
      }
      await this.audit.record(tx, actor, 'ORDER', id, 'ORDER_COST_INPUTS_CHANGED', {
        previous: prior, inputs: next, rates: changes,
      });
      return updated;
    });
  }
}
