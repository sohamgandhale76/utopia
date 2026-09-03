-- CreateIndex
CREATE INDEX "Post_communityId_isDeleted_createdAt_id_idx" ON "Post"("communityId", "isDeleted", "createdAt" DESC, "id" DESC);
