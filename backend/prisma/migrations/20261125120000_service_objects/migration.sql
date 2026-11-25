CREATE TYPE "ServiceRequestStatus" AS ENUM ('NEW','CONVERTED','DECLINED');
CREATE TABLE "ServiceObject" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "address" VARCHAR(300) NOT NULL DEFAULT '',
  "creationKey" UUID NOT NULL,
  "inputHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceObject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceObject_id_clientId_organizationId_key" ON "ServiceObject"("id","clientId","organizationId");
CREATE UNIQUE INDEX "ServiceObject_organizationId_creationKey_key" ON "ServiceObject"("organizationId","creationKey");
CREATE INDEX "ServiceObject_organizationId_clientId_createdAt_id_idx" ON "ServiceObject"("organizationId","clientId","createdAt","id");
ALTER TABLE "ServiceObject" ADD CONSTRAINT "ServiceObject_clientId_organizationId_fkey" FOREIGN KEY ("clientId","organizationId") REFERENCES "Client"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "serviceObjectId" UUID;
CREATE UNIQUE INDEX "Order_id_clientId_organizationId_key" ON "Order"("id","clientId","organizationId");
CREATE INDEX "Order_organizationId_serviceObjectId_createdAt_id_idx" ON "Order"("organizationId","serviceObjectId","createdAt","id");
ALTER TABLE "Order" ADD CONSTRAINT "Order_serviceObjectId_clientId_organizationId_fkey" FOREIGN KEY ("serviceObjectId","clientId","organizationId") REFERENCES "ServiceObject"("id","clientId","organizationId") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE TABLE "ServiceRequest" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "objectId" UUID NOT NULL,
  "sourceOrderId" UUID NOT NULL,
  "convertedOrderId" UUID,
  "status" "ServiceRequestStatus" NOT NULL DEFAULT 'NEW',
  "version" INTEGER NOT NULL DEFAULT 1,
  "description" VARCHAR(1000) NOT NULL,
  "submissionKey" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "inputHash" CHAR(64) NOT NULL,
  "decisionHash" CHAR(64),
  "decisionNote" VARCHAR(300) NOT NULL DEFAULT '',
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceRequest_tokenHash_submissionKey_key" ON "ServiceRequest"("tokenHash","submissionKey");
CREATE UNIQUE INDEX "ServiceRequest_objectId_open_key" ON "ServiceRequest"("objectId") WHERE "status"='NEW';
CREATE INDEX "ServiceRequest_organizationId_objectId_createdAt_id_idx" ON "ServiceRequest"("organizationId","objectId","createdAt","id");
CREATE INDEX "ServiceRequest_organizationId_sourceOrderId_status_idx" ON "ServiceRequest"("organizationId","sourceOrderId","status");
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_objectId_clientId_organizationId_fkey" FOREIGN KEY ("objectId","clientId","organizationId") REFERENCES "ServiceObject"("id","clientId","organizationId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_sourceOrderId_clientId_organizationId_fkey" FOREIGN KEY ("sourceOrderId","clientId","organizationId") REFERENCES "Order"("id","clientId","organizationId") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_convertedOrderId_clientId_organizationId_fkey" FOREIGN KEY ("convertedOrderId","clientId","organizationId") REFERENCES "Order"("id","clientId","organizationId") ON DELETE RESTRICT ON UPDATE NO ACTION;
