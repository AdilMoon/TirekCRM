ALTER TABLE "TelegramLink" ADD COLUMN "selectedReceiptOrderId" UUID;
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ExpenseReceipt" (
  "id" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "sourceKey" UUID NOT NULL UNIQUE,
  "image" BYTEA NOT NULL CHECK (octet_length("image") BETWEEN 1 AND 270000),
  "imageHash" CHAR(64) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0),
  "description" VARCHAR(200) NOT NULL,
  "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewerName" TEXT,
  "expenseId" UUID,
  FOREIGN KEY ("orderId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("employeeId","organizationId") REFERENCES "User"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("expenseId","organizationId") REFERENCES "Expense"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("expenseId","organizationId"),
  CHECK (("status" = 'APPROVED') = ("expenseId" IS NOT NULL)),
  CHECK (("status" = 'PENDING') = ("reviewedAt" IS NULL))
);
CREATE INDEX "ExpenseReceipt_organizationId_status_createdAt_id_idx" ON "ExpenseReceipt"("organizationId","status","createdAt","id");
CREATE INDEX "ExpenseReceipt_orderId_organizationId_idx" ON "ExpenseReceipt"("orderId","organizationId");
CREATE UNIQUE INDEX "ExpenseReceipt_active_image" ON "ExpenseReceipt"("orderId","imageHash") WHERE "status" <> 'REJECTED';
