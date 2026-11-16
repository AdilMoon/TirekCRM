BEGIN;

CREATE TYPE "WorkTimeKind" AS ENUM ('WORK', 'OVERTIME', 'ABSENCE');
ALTER TABLE "WorkTimeEntry" ADD COLUMN "kind" "WorkTimeKind" NOT NULL DEFAULT 'WORK';

CREATE TABLE "WorkTimeMonth" (
    "organizationId" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "closedById" UUID NOT NULL,
    "csv" TEXT NOT NULL,
    CONSTRAINT "WorkTimeMonth_pkey" PRIMARY KEY ("organizationId", "month"),
    CONSTRAINT "WorkTimeMonth_period_check" CHECK ("month" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' AND "startsAt" < "endsAt"),
    CONSTRAINT "WorkTimeMonth_organizationId_fkey" FOREIGN KEY ("organizationId")
        REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkTimeMonth_closedById_organizationId_fkey" FOREIGN KEY ("closedById", "organizationId")
        REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WorkTimeMonth_organizationId_endsAt_idx" ON "WorkTimeMonth"("organizationId", "endsAt");

COMMIT;
