-- Match existing application DateTime fields: UTC wall-clock timestamps.
-- Avoid session-TimeZone-dependent casts in the current Prisma pg adapter.
ALTER TABLE "WorkBooking" DROP CONSTRAINT "WorkBooking_no_overlap";
ALTER TABLE "WorkBooking" DROP CONSTRAINT "WorkBooking_interval_check";
ALTER TABLE "WorkBooking" ALTER COLUMN "startsAt" TYPE TIMESTAMP(3) USING "startsAt" AT TIME ZONE 'UTC';
ALTER TABLE "WorkBooking" ALTER COLUMN "endsAt" TYPE TIMESTAMP(3) USING "endsAt" AT TIME ZONE 'UTC';
ALTER TABLE "WorkBooking" ADD CONSTRAINT "WorkBooking_interval_check" CHECK ("endsAt">"startsAt" AND "endsAt"<="startsAt"+INTERVAL '12 hours');
ALTER TABLE "WorkBooking" ADD CONSTRAINT "WorkBooking_no_overlap" EXCLUDE USING gist ("employeeId" WITH =,tsrange("startsAt","endsAt",'[)') WITH &&) WHERE ("releasedAt" IS NULL);
