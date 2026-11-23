ALTER TABLE "Order" ADD COLUMN "repeatOfId" UUID, ADD COLUMN "repeatKey" UUID, ADD COLUMN "repeatRequestHash" CHAR(64);
ALTER TABLE "Order" DROP CONSTRAINT "Order_total_positive";
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_positive"
  CHECK (total > 0 OR (total = 0 AND "repeatOfId" IS NOT NULL));
ALTER TABLE "Order" ADD CONSTRAINT "Order_repeatOfId_organizationId_fkey"
  FOREIGN KEY ("repeatOfId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE RESTRICT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_repeat_zero_revenue"
  CHECK ("repeatOfId" IS NULL OR ("repeatOfId" <> id AND total = 0 AND "repeatKey" IS NOT NULL));
CREATE UNIQUE INDEX "Order_organizationId_repeatKey_key" ON "Order"("organizationId","repeatKey");
CREATE INDEX "Order_organizationId_repeatOfId_idx" ON "Order"("organizationId","repeatOfId");
CREATE TABLE "OrderAcceptance" (
  "orderId" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  items JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array'),
  UNIQUE ("orderId","organizationId"),
  FOREIGN KEY ("orderId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE CASCADE
);
