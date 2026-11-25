import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderProfitability, OrderProfitabilityInput } from '@tirek/contracts';
import type { AuthRequest } from '../../auth/session.guard';
import { cents, money } from '../../common/money';
import { serializable } from '../../common/transaction';
import { Database } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { orderTimeContributors } from './order-time-totals';

import {select,amounts} from './profitability-calculation';
import {readProfitabilities} from './profitability-reader';
type Actor = AuthRequest['user'];
const normalize=(value:string|null)=>value===null?null:money(cents(value));

@Injectable()
export class OrderProfitabilityService {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  private async order(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    const order = await tx.order.findFirst({ where: { id, organizationId: actor.organizationId }, select });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  detail(actor: Actor, id: string): Promise<OrderProfitability> {
    return this.db.client.$transaction(async tx=>{
      const result=(await readProfitabilities(tx,actor.organizationId,[id])).get(id);
      if(!result)throw new NotFoundException('Заказ не найден');
      return result;
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
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
