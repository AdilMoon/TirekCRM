CREATE TABLE "MaterialLot" (
  "expenseId" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 1000000),
  "available" INTEGER NOT NULL CHECK ("available" BETWEEN 0 AND "quantity"),
  "availableCents" BIGINT NOT NULL CHECK ("availableCents" >= 0 AND ("available" > 0 OR "availableCents" = 0)),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("expenseId","organizationId"),
  FOREIGN KEY ("expenseId","organizationId") REFERENCES "Expense"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MaterialLot_organizationId_createdAt_expenseId_idx" ON "MaterialLot"("organizationId","createdAt","expenseId");
CREATE TABLE "MaterialMovement" (
  "id" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "lotId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" <> 0),
  "costCents" BIGINT NOT NULL CHECK (("quantity" > 0 AND "costCents" >= 0) OR ("quantity" < 0 AND "costCents" <= 0)),
  "idempotencyKey" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId","idempotencyKey"),
  FOREIGN KEY ("lotId","organizationId") REFERENCES "MaterialLot"("expenseId","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("orderId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MaterialMovement_organizationId_orderId_lotId_idx" ON "MaterialMovement"("organizationId","orderId","lotId");
