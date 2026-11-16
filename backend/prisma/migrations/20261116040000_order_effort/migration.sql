ALTER TABLE "Order" ADD COLUMN "plannedMinutes" INTEGER;
ALTER TABLE "Order" ADD CONSTRAINT "Order_plannedMinutes_check"
  CHECK ("plannedMinutes" BETWEEN 1 AND 60000);

WITH first_booking AS (
  SELECT DISTINCT ON ("orderId") "orderId", "organizationId",
         (EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 60)::int AS minutes
  FROM "WorkBooking"
  ORDER BY "orderId", "createdAt", id
)
UPDATE "Order" o SET "plannedMinutes" = b.minutes
FROM first_booking b
WHERE o.id = b."orderId" AND o."organizationId" = b."organizationId"
  AND b.minutes BETWEEN 1 AND 60000;

ALTER TABLE "WorkTimeEntry" ADD COLUMN "submittedOrderId" UUID;
CREATE UNIQUE INDEX "WorkTimeEntry_id_organizationId_key" ON "WorkTimeEntry"("id", "organizationId");

CREATE TABLE "WorkTimeAllocation" (
  "entryId" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "orderId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  CONSTRAINT "WorkTimeAllocation_entryId_organizationId_fkey"
    FOREIGN KEY ("entryId", "organizationId") REFERENCES "WorkTimeEntry"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkTimeAllocation_orderId_organizationId_fkey"
    FOREIGN KEY ("orderId", "organizationId") REFERENCES "Order"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkTimeAllocation_entryId_organizationId_key" ON "WorkTimeAllocation"("entryId", "organizationId");
CREATE INDEX "WorkTimeAllocation_organizationId_orderId_idx" ON "WorkTimeAllocation"("organizationId", "orderId");
