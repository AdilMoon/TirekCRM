CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE "WorkTimeStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'VOIDED');

CREATE TABLE "WorkTimeEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "WorkTimeStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decisionNote" VARCHAR(300) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkTimeEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkTimeEntry_interval_check" CHECK (
        "startsAt" = date_trunc('minute', "startsAt") AND
        "endsAt" = date_trunc('minute', "endsAt") AND
        "endsAt" > "startsAt" AND "endsAt" <= "startsAt" + INTERVAL '24 hours'
    ),
    CONSTRAINT "WorkTimeEntry_decision_check" CHECK (
        ("status" IN ('SUBMITTED', 'APPROVED') AND "decisionNote" = '') OR
        ("status" IN ('REJECTED', 'VOIDED') AND char_length(btrim("decisionNote")) > 0)
    )
);

CREATE UNIQUE INDEX "WorkTimeEntry_organizationId_createdById_idempotencyKey_key"
    ON "WorkTimeEntry"("organizationId", "createdById", "idempotencyKey");
CREATE INDEX "WorkTimeEntry_organizationId_startsAt_id_idx"
    ON "WorkTimeEntry"("organizationId", "startsAt", "id");
CREATE INDEX "WorkTimeEntry_organizationId_employeeId_startsAt_id_idx"
    ON "WorkTimeEntry"("organizationId", "employeeId", "startsAt", "id");

ALTER TABLE "WorkTimeEntry"
    ADD CONSTRAINT "WorkTimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId")
        REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "WorkTimeEntry_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId")
        REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "WorkTimeEntry_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId")
        REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "WorkTimeEntry_no_overlap" EXCLUDE USING gist (
        "employeeId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&
    ) WHERE ("status" IN ('SUBMITTED', 'APPROVED'));
