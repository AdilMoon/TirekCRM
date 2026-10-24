CREATE UNIQUE INDEX "Payment_id_organizationId_key" ON "Payment"("id","organizationId");
CREATE TABLE "PaymentRefund" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "paymentId" UUID NOT NULL,
 "amount" DECIMAL(18,2) NOT NULL, "reason" TEXT NOT NULL,
 "actorId" UUID NOT NULL, "actorName" TEXT NOT NULL, "idempotencyKey" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PaymentRefund_paymentId_organizationId_fkey" FOREIGN KEY ("paymentId","organizationId") REFERENCES "Payment"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PaymentRefund_amount_check" CHECK ("amount">0),
 CONSTRAINT "PaymentRefund_reason_check" CHECK (length(trim("reason")) BETWEEN 3 AND 500)
);
CREATE UNIQUE INDEX "PaymentRefund_organizationId_idempotencyKey_key" ON "PaymentRefund"("organizationId","idempotencyKey");
CREATE INDEX "PaymentRefund_paymentId_organizationId_idx" ON "PaymentRefund"("paymentId","organizationId");
CREATE INDEX "PaymentRefund_organizationId_createdAt_id_idx" ON "PaymentRefund"("organizationId","createdAt","id");
CREATE UNIQUE INDEX "Expense_id_organizationId_key" ON "Expense"("id","organizationId");
CREATE TABLE "ExpenseReversal" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "expenseId" UUID NOT NULL,
 "amount" DECIMAL(18,2) NOT NULL, "reason" TEXT NOT NULL,
 "actorId" UUID NOT NULL, "actorName" TEXT NOT NULL, "idempotencyKey" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ExpenseReversal_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ExpenseReversal_expenseId_organizationId_fkey" FOREIGN KEY ("expenseId","organizationId") REFERENCES "Expense"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ExpenseReversal_amount_check" CHECK ("amount">0),
 CONSTRAINT "ExpenseReversal_reason_check" CHECK (length(trim("reason")) BETWEEN 3 AND 500)
);
CREATE UNIQUE INDEX "ExpenseReversal_organizationId_idempotencyKey_key" ON "ExpenseReversal"("organizationId","idempotencyKey");
CREATE UNIQUE INDEX "ExpenseReversal_expenseId_organizationId_key" ON "ExpenseReversal"("expenseId","organizationId");
CREATE INDEX "ExpenseReversal_organizationId_createdAt_id_idx" ON "ExpenseReversal"("organizationId","createdAt","id");
