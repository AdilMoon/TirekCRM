-- Public session identifiers are unrelated to bearer tokens.
ALTER TABLE "Session" ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Session" ALTER COLUMN "id" DROP DEFAULT;
-- Existing sessions have no trustworthy creation date: preserve NULL for them.
ALTER TABLE "Session" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "Session" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Session" ADD COLUMN "userAgent" VARCHAR(300) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "Session_id_key" ON "Session"("id");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId","expiresAt");
