-- DropIndex
DROP INDEX IF EXISTS "ModerationAction_reportId_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ModerationAction_reportId_idx" ON "ModerationAction"("reportId");
