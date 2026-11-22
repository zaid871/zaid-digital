-- Opt-in GIF preview: Job.gifRequested + FinalVideo.gifKey
-- Applied at deploy via `prisma migrate deploy` (same as the repost migration).
ALTER TABLE "Job" ADD COLUMN "gifRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FinalVideo" ADD COLUMN "gifKey" TEXT;
