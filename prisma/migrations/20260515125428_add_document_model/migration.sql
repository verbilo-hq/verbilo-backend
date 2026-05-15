-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "uploaderId" UUID,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "visibilityScope" TEXT NOT NULL,
    "scopeSiteIds" UUID[],
    "s3Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_tenantId_createdAt_idx" ON "Document"("tenantId", "createdAt" DESC);
