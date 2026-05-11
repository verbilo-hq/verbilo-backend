-- Create staff role enum
CREATE TYPE "StaffRole" AS ENUM ('admin', 'manager', 'dentist', 'hygienist', 'nurse', 'receptionist');

-- Create staff member table
CREATE TABLE "StaffMember" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "siteId" UUID,
    "userId" UUID,
    "firstName" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "StaffRole" NOT NULL,
    "gdcNumber" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- Add unique index for optional user linkage
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");

-- Enforce per-tenant email uniqueness
CREATE UNIQUE INDEX "StaffMember_tenantId_email_key" ON "StaffMember"("tenantId", "email");

-- Query indexes
CREATE INDEX "StaffMember_tenantId_surname_idx" ON "StaffMember"("tenantId", "surname");
CREATE INDEX "StaffMember_tenantId_siteId_idx" ON "StaffMember"("tenantId", "siteId");

-- Add foreign keys
ALTER TABLE "StaffMember"
ADD CONSTRAINT "StaffMember_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffMember"
ADD CONSTRAINT "StaffMember_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StaffMember"
ADD CONSTRAINT "StaffMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

