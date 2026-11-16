ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ORDER_QUOTE_ACCEPTED';

BEGIN;
CREATE TYPE "OrderQuoteKind" AS ENUM ('BASE', 'EXTRA');
CREATE TABLE "OrderQuote" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "kind" "OrderQuoteKind" NOT NULL,
  "basisHash" VARCHAR(64) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OrderQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderQuote_orderId_organizationId_fkey" FOREIGN KEY ("orderId", "organizationId")
    REFERENCES "Order"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderQuote_dates_check" CHECK (
    "expiresAt" > "createdAt"
    AND ("acceptedAt" IS NULL OR ("acceptedAt" >= "createdAt" AND "acceptedAt" < "expiresAt"))
    AND ("revokedAt" IS NULL OR "revokedAt" >= COALESCE("acceptedAt", "createdAt"))
  )
);
CREATE UNIQUE INDEX "OrderQuote_tokenHash_key" ON "OrderQuote"("tokenHash");
CREATE UNIQUE INDEX "OrderQuote_id_organizationId_key" ON "OrderQuote"("id", "organizationId");
CREATE UNIQUE INDEX "OrderQuote_orderId_revision_key" ON "OrderQuote"("orderId", "revision");
CREATE UNIQUE INDEX "OrderQuote_pending_per_order" ON "OrderQuote"("orderId")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
CREATE UNIQUE INDEX "OrderQuote_accepted_base_per_order" ON "OrderQuote"("orderId")
  WHERE "kind" = 'BASE' AND "acceptedAt" IS NOT NULL;

ALTER TABLE "Notification" ADD COLUMN "orderQuoteId" UUID;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderQuoteId_organizationId_fkey"
  FOREIGN KEY ("orderQuoteId", "organizationId")
  REFERENCES "OrderQuote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_quote_kind_check"
  CHECK (("kind" = 'ORDER_QUOTE_ACCEPTED') = ("orderQuoteId" IS NOT NULL));
CREATE INDEX "Notification_orderQuoteId_idx" ON "Notification"("orderQuoteId");
COMMIT;
