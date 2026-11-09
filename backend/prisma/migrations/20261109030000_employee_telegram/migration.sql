CREATE UNIQUE INDEX "Notification_id_organizationId_key" ON "Notification"("id","organizationId");
CREATE TABLE "TelegramPairing" (
 "id" UUID PRIMARY KEY,"userId" UUID NOT NULL,"organizationId" UUID NOT NULL,"botId" VARCHAR(20) NOT NULL,"tokenHash" VARCHAR(64) NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,"telegramUserId" VARCHAR(20),"displayName" VARCHAR(160) NOT NULL DEFAULT '',"username" VARCHAR(32) NOT NULL DEFAULT '',
 CONSTRAINT "TelegramPairing_user_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "User"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "TelegramPairing_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "TelegramPairing_userId_key" ON "TelegramPairing"("userId");
CREATE UNIQUE INDEX "TelegramPairing_userId_organizationId_key" ON "TelegramPairing"("userId","organizationId");
CREATE UNIQUE INDEX "TelegramPairing_tokenHash_key" ON "TelegramPairing"("tokenHash");
CREATE TABLE "TelegramLink" (
 "id" UUID PRIMARY KEY,"userId" UUID NOT NULL,"organizationId" UUID NOT NULL,"botId" VARCHAR(20) NOT NULL,"telegramUserId" VARCHAR(20) NOT NULL,
 "displayName" VARCHAR(160) NOT NULL,"username" VARCHAR(32) NOT NULL,"locale" VARCHAR(2) NOT NULL DEFAULT 'ru',
 "selectedTaskId" UUID,"selectedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TelegramLink_user_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "User"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "TelegramLink_locale_check" CHECK ("locale" IN ('ru','kk','en')),
 CONSTRAINT "TelegramLink_sender_check" CHECK ("telegramUserId" ~ '^[1-9][0-9]{0,19}$')
);
CREATE UNIQUE INDEX "TelegramLink_userId_key" ON "TelegramLink"("userId");
CREATE UNIQUE INDEX "TelegramLink_userId_organizationId_key" ON "TelegramLink"("userId","organizationId");
CREATE UNIQUE INDEX "TelegramLink_id_organizationId_key" ON "TelegramLink"("id","organizationId");
CREATE UNIQUE INDEX "TelegramLink_botId_telegramUserId_key" ON "TelegramLink"("botId","telegramUserId");
CREATE TABLE "TelegramDelivery" (
 "id" UUID PRIMARY KEY,"organizationId" UUID NOT NULL,"linkId" UUID NOT NULL,"notificationId" UUID NOT NULL,
 "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',"attempts" INTEGER NOT NULL DEFAULT 0,"nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "messageId" VARCHAR(20),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"sentAt" TIMESTAMP(3),
 CONSTRAINT "TelegramDelivery_link_fkey" FOREIGN KEY ("linkId","organizationId") REFERENCES "TelegramLink"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "TelegramDelivery_notification_fkey" FOREIGN KEY ("notificationId","organizationId") REFERENCES "Notification"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "TelegramDelivery_status_check" CHECK ("status" IN ('PENDING','SENT','SKIPPED','FAILED') AND "attempts">=0)
);
CREATE UNIQUE INDEX "TelegramDelivery_linkId_notificationId_key" ON "TelegramDelivery"("linkId","notificationId");
CREATE INDEX "TelegramDelivery_status_nextAttemptAt_createdAt_idx" ON "TelegramDelivery"("status","nextAttemptAt","createdAt");
CREATE TABLE "TelegramBotState" (
 "botId" VARCHAR(20) PRIMARY KEY,"nextUpdateId" BIGINT NOT NULL DEFAULT 0,"lastPollAt" TIMESTAMP(3),"leaseToken" UUID,"leaseUntil" TIMESTAMP(3),
 CONSTRAINT "TelegramBotState_offset_check" CHECK ("nextUpdateId">=0 AND "nextUpdateId"<=9007199254740991)
);
CREATE TABLE "TelegramUpdateReceipt" (
 "botId" VARCHAR(20) NOT NULL,"updateId" BIGINT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("botId","updateId")
);
CREATE INDEX "TelegramUpdateReceipt_createdAt_idx" ON "TelegramUpdateReceipt"("createdAt");
