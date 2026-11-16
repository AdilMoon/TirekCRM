ALTER TABLE "Order"
  ADD COLUMN "plannedHourlyRate" DECIMAL(18,2),
  ADD COLUMN "plannedDirectExpenses" DECIMAL(18,2),
  ADD COLUMN "actualHourlyRate" DECIMAL(18,2),
  ADD CONSTRAINT "Order_profitability_nonnegative" CHECK (
    "plannedHourlyRate" >= 0 AND "plannedDirectExpenses" >= 0 AND "actualHourlyRate" >= 0
  );

CREATE TABLE "OrderLaborRate" (
  "organizationId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "hourlyRate" DECIMAL(18,2) NOT NULL CHECK ("hourlyRate" >= 0),
  CONSTRAINT "OrderLaborRate_pkey" PRIMARY KEY ("orderId", "employeeId"),
  CONSTRAINT "OrderLaborRate_orderId_organizationId_fkey"
    FOREIGN KEY ("orderId", "organizationId") REFERENCES "Order"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderLaborRate_employeeId_organizationId_fkey"
    FOREIGN KEY ("employeeId", "organizationId") REFERENCES "User"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OrderLaborRate_employeeId_organizationId_idx" ON "OrderLaborRate"("employeeId","organizationId");
CREATE INDEX "Expense_organizationId_orderId_idx" ON "Expense"("organizationId","orderId");
