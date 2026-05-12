-- CreateTable
CREATE TABLE "UserSiteAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSiteAssignment_pkey" PRIMARY KEY ("id")
);

-- Backfill
INSERT INTO "UserSiteAssignment" ("id", "userId", "siteId", "createdAt")
SELECT gen_random_uuid(), u."id", u."siteId", NOW()
FROM "User" u
WHERE u."siteId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "UserSiteAssignment_userId_siteId_key" ON "UserSiteAssignment"("userId", "siteId");

-- CreateIndex
CREATE INDEX "UserSiteAssignment_userId_idx" ON "UserSiteAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserSiteAssignment_siteId_idx" ON "UserSiteAssignment"("siteId");

-- AddForeignKey
ALTER TABLE "UserSiteAssignment"
ADD CONSTRAINT "UserSiteAssignment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteAssignment"
ADD CONSTRAINT "UserSiteAssignment_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
