CREATE TABLE "PrivacyRequest" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL,
 "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
 "subjectName" TEXT NOT NULL, "contact" TEXT NOT NULL DEFAULT '', "description" TEXT NOT NULL,
 "receivedOn" DATE NOT NULL, "dueOn" DATE,
 "resolution" TEXT NOT NULL DEFAULT '', "createdById" UUID NOT NULL, "createdByName" TEXT NOT NULL,
 "creationKey" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "closedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivacyRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PrivacyRequest_kind_check" CHECK ("kind" IN ('ACCESS','CORRECTION','DELETION','WITHDRAWAL','OTHER')),
 CONSTRAINT "PrivacyRequest_dates_check" CHECK ("dueOn" IS NULL OR "dueOn">="receivedOn"),
 CONSTRAINT "PrivacyRequest_version_check" CHECK ("version">=1),
 CONSTRAINT "PrivacyRequest_status_check" CHECK (
  ("status" IN ('OPEN','IN_PROGRESS') AND "closedAt" IS NULL AND "resolution"='') OR
  ("status" IN ('RESOLVED','REJECTED') AND "closedAt" IS NOT NULL AND length(trim("resolution")) BETWEEN 3 AND 1000)
 )
);
CREATE UNIQUE INDEX "PrivacyRequest_organizationId_creationKey_key" ON "PrivacyRequest"("organizationId","creationKey");
CREATE UNIQUE INDEX "PrivacyRequest_id_organizationId_key" ON "PrivacyRequest"("id","organizationId");
CREATE INDEX "PrivacyRequest_organizationId_dueOn_createdAt_id_idx" ON "PrivacyRequest"("organizationId","dueOn","createdAt","id");
CREATE TABLE "PrivacyRequestChangeReceipt" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "requestId" UUID NOT NULL,
 "idempotencyKey" UUID NOT NULL, "actorId" UUID NOT NULL, "inputHash" VARCHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivacyRequestChangeReceipt_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivacyRequestChangeReceipt_requestId_organizationId_fkey" FOREIGN KEY ("requestId","organizationId") REFERENCES "PrivacyRequest"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrivacyRequestChangeReceipt_organizationId_idempotencyKey_key" ON "PrivacyRequestChangeReceipt"("organizationId","idempotencyKey");
