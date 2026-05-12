-- AlterTable
ALTER TABLE "Tenant"
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "primaryColor" VARCHAR(9),
  ADD COLUMN "secondaryColor" VARCHAR(9),
  ADD COLUMN "accentColor" VARCHAR(9);
