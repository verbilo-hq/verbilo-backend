-- Add tenant provisioning columns
ALTER TABLE "Tenant" ADD COLUMN "slug" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "sector" TEXT NOT NULL DEFAULT 'dental';
ALTER TABLE "Tenant" ADD COLUMN "enabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tenant" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Tenant" ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "Tenant"
SET "slug" = trim(
  both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))
);

ALTER TABLE "Tenant" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- Add lightweight app-layer role support
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'employee';

-- Create loose audit log table without foreign keys so history survives deletes
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "tenantId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payloadJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt" DESC);
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt" DESC);
