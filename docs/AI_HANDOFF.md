# AI Handoff — Stage 4 Finalization

## Purpose

This file transfers accurate working context between AI agents. Read it together with `docs/PROJECT_CONTEXT.md`. When they conflict, this file is authoritative until the documented correction pass below is complete.

## Product

Open-source, pseudonymous, community-first platform. V1 is plain text only; communities are public to read, while participation requires membership. Do not introduce private communities, media, direct messages, recommendations, search, notifications, or rate limiting unless a later approved stage explicitly requires them.

## Foundation already implemented

- Stage 1: Next.js/Prisma/PostgreSQL foundation, strict isolated test database (`instapro_test` on port 5433), report target CHECK constraint, and corrected moderation-action migration.
- Stage 2: pseudonymous auth using lowercase usernames, bcrypt cost 12, opaque 256-bit session tokens stored only as SHA-256 hashes, HttpOnly SameSite=Lax cookies, suspended-session invalidation, and a closed public-registration gate.
- Stage 3A: community/membership service layer with Serializable transactions and bounded Prisma `P2034` retry for ownership-sensitive flows.
- Stage 3B: public community directory/detail UI, authenticated community creation route, and server-derived join/leave identity.
- Stage 4 content implementation: plain-text posts, threaded comments with max depth 5, public chronological community feed, public post detail UI, and authenticated create post/comment actions.

## Stage 4 correction code currently present

- `Post` has the composite feed index `[communityId, isDeleted, createdAt DESC, id DESC]` in a distinct third migration: `20260903213816_optimize_community_feed_index`.
- Public post/comment author selection returns only `id` and `username`, never global `role` or credentials.
- `createPost` and `createComment` run Serializable Prisma transactions with bounded `P2034` retry. Membership validation happens inside those transactions.
- Comments on deleted posts are rejected.
- Feed ordering is `createdAt DESC, id DESC`; pagination uses a base64url cursor containing `{ id, createdAt }` and a true keyset predicate.
- The current build was independently run successfully after this code correction.

## Do not proceed to Stage 5 yet

Stage 4 needs one final small pass. `docs/PROJECT_CONTEXT.md` currently contains stale/conflicting data:

- It says there are two migrations, but there are three.
- It says 72 tests / 6 content tests, while the agent reported 75 total after the correction tests. Re-run tests and record only the actual result.
- It omits Stage 4 from Current Status and Completed Work.
- It falsely says PostgreSQL rate limiting is already enforced; rate limiting is not implemented.
- It still lists “Stage 4 correction pass” as the immediate next task.
- `feedCursorSchema` in `src/features/content/validation.ts` is unused. Server-side `getCommunityFeed` must validate its `limit` as a finite integer 1–100 with default 50.

## Non-negotiable rules

- Preserve all Stage 1 test-database guards. Tests must only use `TEST_DATABASE_URL` targeting `instapro_test` on port 5433 and must never fall back to `DATABASE_URL`.
- Do not edit existing applied migrations. New schema changes require a new migration.
- Do not return password hashes, raw session tokens, or session hashes to clients.
- Do not expose global `User.role` in public content author data.
- Server actions derive the acting user from `requireUser()`; never trust a client-supplied author ID.
- Do not claim PostgreSQL 16 compatibility has been verified. The local bundled test binary is PostgreSQL 18.4; PostgreSQL 16 remains a pre-deployment check.
- Do not claim tests, builds, commits, or documentation updates without actually performing them.

## Exact next prompt for the new agent

```text
Read docs/AI_HANDOFF.md, docs/PROJECT_CONTEXT.md, and src/features/content/service.ts first.

Make a final Stage 4 accuracy and validation pass only. Do not start Stage 5 and do not alter product features.

1. Validate the getCommunityFeed limit server-side: accept only a finite integer from 1 to 100, with a safe default of 50. Reuse or replace the currently unused feedCursorSchema so there is no dead validation code.
2. Add a focused integration test for invalid or out-of-range feed limits.
3. Correct docs/PROJECT_CONTEXT.md truthfully:
   - Add Stage 4: Content Foundation — Complete to Current Status and Completed Work.
   - Record 3 applied migrations, including the Post community feed index migration.
   - Record the actual final test count and Stage 4 test count after verification.
   - Replace the false “PostgreSQL Rate Limiting: Enforced” statement with a clear note that rate limiting is not implemented yet.
   - Set the immediate next task to: “Stage 5 planning: voting, reporting, sanctions, moderation actions, and public moderation transparency. No search or notifications yet.”

Run npm test and npm run build. Only write final verification numbers that the commands actually produce. Do not claim a commit unless one is actually created.
```
