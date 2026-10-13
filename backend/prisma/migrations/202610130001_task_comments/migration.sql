-- Additive migration: preserve all existing tasks and business data.
CREATE UNIQUE INDEX "BusinessTask_id_organizationId_key" ON "BusinessTask"("id", "organizationId");

CREATE TABLE "TaskComment" (
 "id" UUID NOT NULL,
 "organizationId" UUID NOT NULL,
 "taskId" UUID NOT NULL,
 "authorId" UUID NOT NULL,
 "authorName" TEXT NOT NULL,
 "body" VARCHAR(2000) NOT NULL,
 "idempotencyKey" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "TaskComment_body_length" CHECK (char_length(btrim("body")) BETWEEN 1 AND 2000)
);
CREATE UNIQUE INDEX "TaskComment_organizationId_authorId_idempotencyKey_key"
 ON "TaskComment"("organizationId", "authorId", "idempotencyKey");
CREATE INDEX "TaskComment_organizationId_taskId_createdAt_id_idx"
 ON "TaskComment"("organizationId", "taskId", "createdAt", "id");
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_organizationId_fkey"
 FOREIGN KEY ("taskId", "organizationId") REFERENCES "BusinessTask"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_organizationId_fkey"
 FOREIGN KEY ("authorId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
