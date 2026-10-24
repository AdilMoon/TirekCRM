ALTER TABLE "Document"
 ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "annulledAt" TIMESTAMP(3),
 ADD COLUMN "annulledById" UUID,
 ADD COLUMN "annulledByName" TEXT,
 ADD COLUMN "annulmentReason" TEXT,
 ADD COLUMN "annulmentKey" UUID;
CREATE UNIQUE INDEX "Document_organizationId_annulmentKey_key" ON "Document"("organizationId", "annulmentKey");
ALTER TABLE "Document" ADD CONSTRAINT "Document_annulment_state_check" CHECK (
 ("status"='DRAFT' AND "version"=1 AND "annulledAt" IS NULL AND "annulledById" IS NULL AND "annulledByName" IS NULL AND "annulmentReason" IS NULL AND "annulmentKey" IS NULL)
 OR
 ("status"='ANNULLED' AND "version"=2 AND "annulledAt" IS NOT NULL AND "annulledById" IS NOT NULL AND "annulledByName" IS NOT NULL AND "annulmentReason" IS NOT NULL AND length(trim("annulmentReason")) BETWEEN 3 AND 500 AND "annulmentKey" IS NOT NULL)
);
