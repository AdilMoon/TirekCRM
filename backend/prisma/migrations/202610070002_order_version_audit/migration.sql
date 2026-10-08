ALTER TABLE "Order" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Order" ADD CONSTRAINT "Order_version_positive" CHECK ("version" > 0);
CREATE TABLE "AuditEvent" (
 "id" UUID NOT NULL,
 "organizationId" UUID NOT NULL,
 "actorId" UUID NOT NULL,
 "actorName" TEXT NOT NULL,
 "entityType" TEXT NOT NULL,
 "entityId" UUID NOT NULL,
 "action" TEXT NOT NULL,
 "metadata" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AuditEvent_organizationId_createdAt_id_idx" ON "AuditEvent"("organizationId","createdAt","id");
CREATE INDEX "AuditEvent_organizationId_entityType_entityId_createdAt_idx" ON "AuditEvent"("organizationId","entityType","entityId","createdAt");
CREATE INDEX "Order_organizationId_createdAt_id_idx" ON "Order"("organizationId","createdAt","id");
CREATE INDEX "Client_organizationId_createdAt_id_idx" ON "Client"("organizationId","createdAt","id");
