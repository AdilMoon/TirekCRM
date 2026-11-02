-- Existing reversals remain standalone (NULL); no historical amounts are rewritten.
ALTER TABLE "ExpenseReversal" ADD COLUMN "replacementExpenseId" UUID;
CREATE UNIQUE INDEX "ExpenseReversal_replacementExpenseId_organizationId_key"
 ON "ExpenseReversal"("replacementExpenseId","organizationId");
ALTER TABLE "ExpenseReversal" ADD CONSTRAINT "ExpenseReversal_replacementExpenseId_organizationId_fkey"
 FOREIGN KEY ("replacementExpenseId","organizationId") REFERENCES "Expense"("id","organizationId")
 ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseReversal" ADD CONSTRAINT "ExpenseReversal_replacement_not_self_check"
 CHECK ("replacementExpenseId" IS NULL OR "replacementExpenseId" <> "expenseId");
