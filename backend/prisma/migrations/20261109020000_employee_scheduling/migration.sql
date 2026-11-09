CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE "WorkProfile" (
 "userId" UUID PRIMARY KEY,"organizationId" UUID NOT NULL,"skills" TEXT[] NOT NULL,"weekdays" INTEGER[] NOT NULL,
 "startMinute" INTEGER NOT NULL,"endMinute" INTEGER NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "WorkProfile_user_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "User"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WorkProfile_hours_check" CHECK ("startMinute">=0 AND "endMinute"<=1440 AND "startMinute"<"endMinute" AND "startMinute"%15=0 AND "endMinute"%15=0),
 CONSTRAINT "WorkProfile_days_check" CHECK ("weekdays" <@ ARRAY[1,2,3,4,5,6,7] AND cardinality("weekdays")<=7),
 CONSTRAINT "WorkProfile_version_check" CHECK ("version">0)
);
CREATE TABLE "WorkBooking" (
 "id" UUID PRIMARY KEY,"organizationId" UUID NOT NULL,"orderId" UUID NOT NULL,"employeeId" UUID NOT NULL,"taskId" UUID NOT NULL,
 "startsAt" TIMESTAMPTZ(3) NOT NULL,"endsAt" TIMESTAMPTZ(3) NOT NULL,"requiredSkills" TEXT[] NOT NULL,
 "createdById" UUID NOT NULL,"idempotencyKey" UUID NOT NULL,"inputHash" VARCHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"releasedAt" TIMESTAMP(3),
 CONSTRAINT "WorkBooking_order_fkey" FOREIGN KEY ("orderId","organizationId") REFERENCES "Order"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WorkBooking_employee_fkey" FOREIGN KEY ("employeeId","organizationId") REFERENCES "User"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "WorkBooking_task_fkey" FOREIGN KEY ("taskId","organizationId") REFERENCES "BusinessTask"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WorkBooking_interval_check" CHECK ("endsAt">"startsAt" AND "endsAt"<="startsAt"+INTERVAL '12 hours'),
 CONSTRAINT "WorkBooking_hash_check" CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "WorkBooking_no_overlap" EXCLUDE USING gist ("employeeId" WITH =,tstzrange("startsAt","endsAt",'[)') WITH &&) WHERE ("releasedAt" IS NULL)
);
CREATE UNIQUE INDEX "WorkBooking_taskId_key" ON "WorkBooking"("taskId");
CREATE UNIQUE INDEX "WorkProfile_userId_organizationId_key" ON "WorkProfile"("userId","organizationId");
CREATE UNIQUE INDEX "WorkBooking_taskId_organizationId_key" ON "WorkBooking"("taskId","organizationId");
CREATE UNIQUE INDEX "WorkBooking_organizationId_idempotencyKey_key" ON "WorkBooking"("organizationId","idempotencyKey");
CREATE UNIQUE INDEX "WorkBooking_one_current_order" ON "WorkBooking"("orderId") WHERE "releasedAt" IS NULL;
CREATE INDEX "WorkBooking_organizationId_startsAt_endsAt_idx" ON "WorkBooking"("organizationId","startsAt","endsAt");
