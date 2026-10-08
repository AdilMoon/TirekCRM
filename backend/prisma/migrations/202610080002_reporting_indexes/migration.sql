-- Stable chronological pages for financial operations and documents.
CREATE INDEX "Payment_organizationId_createdAt_id_idx" ON "Payment"("organizationId","createdAt","id");
CREATE INDEX "Expense_organizationId_createdAt_id_idx" ON "Expense"("organizationId","createdAt","id");
CREATE INDEX "Document_organizationId_createdAt_id_idx" ON "Document"("organizationId","createdAt","id");
