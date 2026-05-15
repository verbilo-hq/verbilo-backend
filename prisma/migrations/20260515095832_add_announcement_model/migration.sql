-- CreateTable
CREATE TABLE "Announcement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "authorId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibilityScope" TEXT NOT NULL,
    "scopeSiteIds" UUID[],
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_tenantId_publishedAt_idx" ON "Announcement"("tenantId", "publishedAt" DESC);
