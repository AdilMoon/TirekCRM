import type { Prisma } from '@prisma/client';
import type { ExpenseInput } from '@tirek/contracts';
import type { Actor, AuditService } from '../audit/audit.service';

export async function recordExpense(tx: Prisma.TransactionClient, audit: AuditService, actor: Actor, input: ExpenseInput) {
  const expense = await tx.expense.create({ data: { ...input, organizationId: actor.organizationId } });
  await audit.record(tx, actor, 'EXPENSE', expense.id, 'EXPENSE_RECORDED', {
    amount: expense.amount.toFixed(2), category: expense.category,
  });
  return expense;
}
