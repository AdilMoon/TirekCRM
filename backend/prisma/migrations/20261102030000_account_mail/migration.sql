CREATE TABLE "MailMessage" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "organizationId" UUID NOT NULL,
 "recipient" VARCHAR(254) NOT NULL, "kind" VARCHAR(32) NOT NULL,
 "eventKey" VARCHAR(160) NOT NULL, "deliveryMode" VARCHAR(16) NOT NULL,
 "payload" TEXT, "expiresAt" TIMESTAMP(3),
 "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseToken" UUID, "leaseUntil" TIMESTAMP(3), "lastErrorCode" VARCHAR(32),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMP(3),
 CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "MailMessage_userId_organizationId_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "User"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "MailMessage_kind_check" CHECK ("kind" IN ('WELCOME','PASSWORD_CHANGED','PASSWORD_RESET')),
 CONSTRAINT "MailMessage_mode_check" CHECK ("deliveryMode" IN ('local','gmail')),
 CONSTRAINT "MailMessage_status_check" CHECK ("status" IN ('PENDING','SENT','FAILED','SKIPPED')),
 CONSTRAINT "MailMessage_attempts_check" CHECK ("attempts">=0)
);
CREATE UNIQUE INDEX "MailMessage_organizationId_eventKey_key" ON "MailMessage"("organizationId","eventKey");
CREATE INDEX "MailMessage_deliveryMode_status_nextAttemptAt_createdAt_idx" ON "MailMessage"("deliveryMode","status","nextAttemptAt","createdAt");
