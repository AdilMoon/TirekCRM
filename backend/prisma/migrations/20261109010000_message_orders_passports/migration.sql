CREATE TABLE "MessageOrderReceipt" (
 "id" UUID NOT NULL PRIMARY KEY,"organizationId" UUID NOT NULL,"idempotencyKey" UUID NOT NULL,
 "inputHash" VARCHAR(64) NOT NULL,"actorId" UUID NOT NULL,"orderId" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MessageOrderReceipt_orderId_organizationId_fkey" FOREIGN KEY ("orderId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "MessageOrderReceipt_hash_check" CHECK ("inputHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "MessageOrderReceipt_orderId_key" ON "MessageOrderReceipt"("orderId");
CREATE UNIQUE INDEX "MessageOrderReceipt_orderId_organizationId_key" ON "MessageOrderReceipt"("orderId","organizationId");
CREATE UNIQUE INDEX "MessageOrderReceipt_organizationId_idempotencyKey_key" ON "MessageOrderReceipt"("organizationId","idempotencyKey");
CREATE TABLE "OrderPassport" (
 "orderId" UUID NOT NULL PRIMARY KEY,"organizationId" UUID NOT NULL,"tokenHash" VARCHAR(64) NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,"revokedAt" TIMESTAMP(3),"revision" INTEGER NOT NULL DEFAULT 1,
 "confirmedAt" TIMESTAMP(3),"confirmedOrderVersion" INTEGER,"confirmedRevision" INTEGER,
 CONSTRAINT "OrderPassport_orderId_organizationId_fkey" FOREIGN KEY ("orderId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "OrderPassport_revision_check" CHECK ("revision">0),
 CONSTRAINT "OrderPassport_token_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "OrderPassport_tokenHash_key" ON "OrderPassport"("tokenHash");
CREATE UNIQUE INDEX "OrderPassport_orderId_organizationId_key" ON "OrderPassport"("orderId","organizationId");
CREATE TABLE "OrderPhoto" (
 "id" UUID NOT NULL PRIMARY KEY,"orderId" UUID NOT NULL,"organizationId" UUID NOT NULL,"createdById" UUID NOT NULL,"phase" VARCHAR(6) NOT NULL,
 "shared" BOOLEAN NOT NULL DEFAULT false,"image" BYTEA NOT NULL,"inputHash" VARCHAR(64) NOT NULL,"idempotencyKey" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OrderPhoto_orderId_organizationId_fkey" FOREIGN KEY ("orderId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "OrderPhoto_phase_check" CHECK ("phase" IN ('BEFORE','AFTER')),
 CONSTRAINT "OrderPhoto_size_check" CHECK (octet_length("image") BETWEEN 1 AND 200000)
);
CREATE UNIQUE INDEX "OrderPhoto_orderId_idempotencyKey_key" ON "OrderPhoto"("orderId","idempotencyKey");
CREATE INDEX "OrderPhoto_orderId_organizationId_createdAt_id_idx" ON "OrderPhoto"("orderId","organizationId","createdAt","id");
