-- Create partial unique index for pending post reports
CREATE UNIQUE INDEX "Report_reporterId_postId_pending_unique" ON "Report" ("reporterId", "postId")
WHERE "status" = 'PENDING' AND "postId" IS NOT NULL;

-- Create partial unique index for pending comment reports
CREATE UNIQUE INDEX "Report_reporterId_commentId_pending_unique" ON "Report" ("reporterId", "commentId")
WHERE "status" = 'PENDING' AND "commentId" IS NOT NULL;
