import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import type { receiptListSchema, receiptDecisionSchema } from '@tirek/contracts';
import { Database } from '../../database/database.service';
import { serializable } from '../../common/transaction';
import { AuditService, type Actor } from '../audit/audit.service';
import { recordExpense } from './expense-writer';

@Injectable()
export class ExpenseReceiptsService {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  submit(actor: Actor, selection: { linkId: string; taskId: string; orderId: string; selectedAt: Date },
    input: { image: Buffer; sourceKey: string; amount: string; description: string }) {
    const { organizationId } = actor;
    const { orderId, taskId } = selection;
    const imageHash = createHash('sha256').update(input.image).digest('hex');
    return serializable(this.db.client, async tx => {
      const link = await tx.telegramLink.findFirst({ where: {
        id: selection.linkId, userId: actor.id, organizationId, user: { isActive: true, role: 'EMPLOYEE' },
        selectedTaskId: taskId, selectedReceiptOrderId: orderId, selectedAt: selection.selectedAt,
      }, select: { id: true } });
      if (!link || selection.selectedAt.getTime() < Date.now() - 900000) throw new ForbiddenException();
      const task = await tx.businessTask.findFirst({ where: { id: taskId, orderId, assigneeId: actor.id,
        organizationId, status: { in: ['TODO', 'IN_PROGRESS'] } }, select: { id: true } });
      if (!task) throw new NotFoundException();
      const duplicate = await tx.expenseReceipt.findFirst({ where: { organizationId, orderId,
        OR: [{ sourceKey: input.sourceKey }, { imageHash, status: { not: 'REJECTED' } }] }, select: { id: true } });
      if (!duplicate) {
        const receipt = await tx.expenseReceipt.create({ data: { organizationId, orderId, employeeId: actor.id,
          sourceKey: input.sourceKey, amount: input.amount, description: input.description, imageHash, image: new Uint8Array(input.image) },
          select: { id: true } });
        await this.audit.record(tx, actor, 'ORDER', orderId, 'RECEIPT_SUBMITTED', { receiptId: receipt.id });
      }
      await tx.telegramLink.update({ where: { id: link.id }, data: { selectedAt: null, selectedTaskId: null, selectedReceiptOrderId: null } });
      return { duplicate: !!duplicate };
    });
  }

  async list(organizationId: string, query: z.infer<typeof receiptListSchema>) {
    const where = { organizationId, status: query.status, orderId: query.orderId };
    const pageSize = 10;
    const [items, total] = await this.db.client.$transaction([
      this.db.client.expenseReceipt.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize, skip: (query.page - 1) * pageSize,
        select: { id: true, amount: true, description: true, employee: { select: { name: true } },
          order: { select: { id: true, number: true, title: true } }, createdAt: true, reviewedAt: true, reviewerName: true } }),
      this.db.client.expenseReceipt.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: items.map(row => ({ ...row, amount: row.amount.toFixed(2) })),
      total, pageSize, page: query.page, pages: Math.ceil(total / pageSize) };
  }

  async photo(organizationId: string, id: string) {
    const row = await this.db.client.expenseReceipt.findFirst({ where: { organizationId, id }, select: { image: true } });
    if (!row) throw new NotFoundException('Чек не найден');
    return Buffer.from(row.image);
  }

  decide(actor: Actor, id: string, decision: z.infer<typeof receiptDecisionSchema>) {
    const organizationId = actor.organizationId;
    return serializable(this.db.client, async tx => {
      const owner = await tx.user.findFirst({ where: { id: actor.id, organizationId, isActive: true, role: 'OWNER' }, select: { name: true } });
      if (!owner) throw new ForbiddenException('Недостаточно прав');
      const row = await tx.expenseReceipt.findFirst({ where: { id, organizationId },
        select: { orderId: true, amount: true, description: true, status: true, expense: { select: { id: true, category: true } } } });
      if (!row) throw new NotFoundException('Чек не найден');
      if (row.status !== 'PENDING') {
        if (row.status !== decision.status || (decision.status === 'APPROVED' && row.expense?.category !== decision.category))
          throw new ConflictException('По чеку уже принято другое решение');
        return { status: row.status, expenseId: row.expense?.id ?? null };
      }
      const expense = decision.status === 'APPROVED' ? await recordExpense(tx, this.audit, actor, {
        orderId: row.orderId, amount: row.amount.toFixed(2), description: row.description,
        category: decision.category, idempotencyKey: randomUUID(),
      }) : null;
      const expenseId = expense?.id ?? null;
      await tx.expenseReceipt.update({ where: { id }, data: { status: decision.status, expenseId, reviewedAt: new Date(), reviewerName: owner.name } });
      await this.audit.record(tx, actor, 'ORDER', row.orderId, decision.status === 'APPROVED' ? 'RECEIPT_APPROVED' : 'RECEIPT_REJECTED', { receiptId: id, expenseId });
      return { status: decision.status, expenseId };
    });
  }
}
