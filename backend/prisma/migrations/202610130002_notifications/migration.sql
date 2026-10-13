-- Additive migration; existing events are not retroactively broadcast.
CREATE TYPE "NotificationKind" AS ENUM ('TASK_ASSIGNED', 'TASK_STATUS_CHANGED', 'TASK_COMMENT_ADDED');
CREATE TABLE "Notification" (
 "id" UUID NOT NULL,
 "organizationId" UUID NOT NULL,
 "recipientId" UUID NOT NULL,
 "taskId" UUID NOT NULL,
 "kind" "NotificationKind" NOT NULL,
 "eventKey" VARCHAR(160) NOT NULL,
 "actorName" TEXT NOT NULL,
 "taskStatus" "TaskStatus",
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "readAt" TIMESTAMP(3),
 CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Notification_organizationId_recipientId_eventKey_key" ON "Notification"("organizationId","recipientId","eventKey");
CREATE INDEX "Notification_organizationId_recipientId_createdAt_id_idx" ON "Notification"("organizationId","recipientId","createdAt","id");
CREATE INDEX "Notification_organizationId_recipientId_readAt_idx" ON "Notification"("organizationId","recipientId","readAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_organizationId_fkey"
 FOREIGN KEY ("taskId","organizationId") REFERENCES "BusinessTask"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_organizationId_fkey"
 FOREIGN KEY ("recipientId","organizationId") REFERENCES "User"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
