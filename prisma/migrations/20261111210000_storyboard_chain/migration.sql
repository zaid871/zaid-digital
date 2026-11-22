-- Opt-in storyboard chain (Raj, 2026-11-10): Job.storyboardChain
-- Applied at deploy via `prisma migrate deploy` (same as the repost/gif migrations).
ALTER TABLE "Job" ADD COLUMN "storyboardChain" BOOLEAN NOT NULL DEFAULT false;
