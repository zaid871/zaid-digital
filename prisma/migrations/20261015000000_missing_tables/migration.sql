-- Repair migration (2026-11-13, deploy fix):
-- The 20261009132447_init migration created only 21 of the 29 tables in
-- schema.prisma. Eight models (Product, ProductFact, AffiliateLink,
-- PublishRecord, AnalyticsRecord, ExperimentRecord, WorkflowRun,
-- QuotaRecord) plus Job.productId / Job.scriptStyle never had a migration.
-- 20261029210000_repost_variant then failed on a fresh DB because
-- PublishRecord did not exist. This migration (timestamped between init
-- and repost_variant) creates the missing tables, so the later migrations
-- apply cleanly. Generated from `prisma migrate diff` (live DB vs schema)
-- with the pieces owned by later migrations removed:
--   * FinalVideo.gifKey + Job.gifRequested -> 20261108200000_add_gif
--   * Job.storyboardChain                  -> 20261111210000_storyboard_chain
--   * PublishRecord.videoUrl / variantOf + variantOf FK -> 20261029210000_repost_variant

-- AlterTable (Job columns with no migration of their own)
ALTER TABLE "Job" ADD COLUMN "productId" TEXT,
ADD COLUMN "scriptStyle" TEXT;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "description" TEXT,
    "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dedupHash" TEXT NOT NULL,
    "businessState" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "stateReason" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFact" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateLink" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "disclosure" TEXT NOT NULL DEFAULT 'Affiliate link — I may earn a commission at no extra cost to you.',
    "validationStatus" TEXT NOT NULL DEFAULT 'unchecked',
    "lastCheckedAt" TIMESTAMP(3),
    "httpStatus" INTEGER,
    "finalUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable (videoUrl / variantOf are added by 20261029210000_repost_variant)
CREATE TABLE "PublishRecord" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "jobId" TEXT,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "platformMediaId" TEXT,
    "caption" TEXT,
    "permalink" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsRecord" (
    "id" TEXT NOT NULL,
    "publishRecordId" TEXT NOT NULL,
    "views" INTEGER,
    "reach" INTEGER,
    "engagement" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "linkClicks" INTEGER,
    "conversions" INTEGER,
    "revenueUsd" DECIMAL(10,4),
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentRecord" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "variant" TEXT,
    "metrics" JSONB,
    "conclusion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "n8nExecutionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'started',
    "productId" TEXT,
    "jobId" TEXT,
    "detail" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaRecord" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "usedUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "limitUnits" DOUBLE PRECISION,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_dedupHash_key" ON "Product"("dedupHash");

-- CreateIndex
CREATE INDEX "Product_businessState_idx" ON "Product"("businessState");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "ProductFact_productId_status_idx" ON "ProductFact"("productId", "status");

-- CreateIndex
CREATE INDEX "AffiliateLink_productId_isActive_idx" ON "AffiliateLink"("productId", "isActive");

-- CreateIndex
CREATE INDEX "PublishRecord_platform_status_idx" ON "PublishRecord"("platform", "status");

-- CreateIndex
CREATE INDEX "PublishRecord_productId_idx" ON "PublishRecord"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishRecord_platform_platformMediaId_key" ON "PublishRecord"("platform", "platformMediaId");

-- CreateIndex
CREATE INDEX "AnalyticsRecord_publishRecordId_collectedAt_idx" ON "AnalyticsRecord"("publishRecordId", "collectedAt");

-- CreateIndex
CREATE INDEX "ExperimentRecord_status_idx" ON "ExperimentRecord"("status");

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowKey_startedAt_idx" ON "WorkflowRun"("workflowKey", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun"("status");

-- CreateIndex
CREATE INDEX "QuotaRecord_providerKey_capability_windowStart_idx" ON "QuotaRecord"("providerKey", "capability", "windowStart");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFact" ADD CONSTRAINT "ProductFact_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishRecord" ADD CONSTRAINT "PublishRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsRecord" ADD CONSTRAINT "AnalyticsRecord_publishRecordId_fkey" FOREIGN KEY ("publishRecordId") REFERENCES "PublishRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentRecord" ADD CONSTRAINT "ExperimentRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
