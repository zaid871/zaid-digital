-- Repost ("second chance") loop: video URL + variant linkage on PublishRecord
ALTER TABLE "PublishRecord" ADD COLUMN "videoUrl" TEXT;
ALTER TABLE "PublishRecord" ADD COLUMN "variantOf" TEXT;
ALTER TABLE "PublishRecord" ADD CONSTRAINT "PublishRecord_variantOf_fkey" FOREIGN KEY ("variantOf") REFERENCES "PublishRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PublishRecord_variantOf_idx" ON "PublishRecord"("variantOf");
