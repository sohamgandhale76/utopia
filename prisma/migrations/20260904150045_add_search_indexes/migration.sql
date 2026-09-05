-- Add PostgreSQL GIN expression indexes for full-text search

CREATE INDEX "Community_search_idx" ON "Community" USING gin(to_tsvector('english', "name" || ' ' || "description"));

CREATE INDEX "Post_search_idx" ON "Post" USING gin(to_tsvector('english', "title" || ' ' || "body"));