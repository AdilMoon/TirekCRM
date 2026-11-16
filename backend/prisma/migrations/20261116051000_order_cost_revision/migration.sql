ALTER TABLE "Order" ADD COLUMN "costVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Order" ADD CONSTRAINT "Order_costVersion_positive" CHECK ("costVersion" > 0);
