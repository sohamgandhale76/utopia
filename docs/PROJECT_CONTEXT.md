# Project Context

## Project purpose
Building an open-source, pseudonymous, community-first social platform where users can be anonymous to each other, but not free from accountability. All content, feeds, scoring, and moderation actions are transparent, deterministic, and explainable.

## Current status
Stage 1: Core Foundation and Custom Migrations — Complete

## Approved architecture
- **Framework**: Next.js 15 App Router (React 19, TypeScript)
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL 16 via Prisma ORM
- **Database Infrastructure**:
  - Preferred / authoritative: Docker Compose (`docker-compose.yml` with health checks) or native PostgreSQL 16 server.
  - Optional local Windows fallback: `embedded-postgres` pinned to exact version (`18.4.0-beta.17`), strictly for local development (`npm run db:local`) and testing without Docker. Never for production.
- **Architecture Style**: Modular monolith partitioned by domain features under `src/features/` (`auth`, `communities`, `posts`, `comments`, `votes`, `sanctions`, `moderation`, `rate-limit`)
- **Testing**: Vitest for unit & integration testing with strict test database isolation

## Locked product decisions
1. **Public Moderator Pseudonyms**: The append-only application audit log displays the acting moderator's username (e.g. `Removed by mod_sarah: Spam`) for mutual accountability.
2. **Sole Community Owner Guard**: A sole community owner cannot leave without first transferring `OWNER` to another member.
3. **Negative Vote Scores**: Aggregate scores (`upvotes - downvotes`) are unbounded and allowed to be negative.
4. **Hidden Member Rosters**: Public community member counts are public, but the roster of member usernames is hidden from non-moderators to prevent scraping and user profiling.
5. **No Private Communities in V1**: All communities are publicly readable. Participation (posting, commenting, voting, reporting) requires community membership.
6. **Plain Text Only**: V1 posts and comments are strictly plain text (zero Markdown or HTML parsing; whitespace preserved via CSS).

## Security constraints
- **Pre-Launch Registration Abuse Control**: Public registration is strictly gated (`ALLOW_PUBLIC_REGISTRATION=false`) until an unauthenticated abuse-control mechanism (proof-of-work, CAPTCHA, or invite system) is implemented.
- **Account Recovery Tradeoff**: No email or phone collected; zero PII stored. If a password is lost, account recovery is impossible.
- **Password Constraints**: Minimum 12 characters, maximum 64 UTF-8 bytes before bcrypt hashing (protects against 72-byte truncation and DoS).
- **Session Tokens**: 256-bit cryptographically secure random tokens issued in `HttpOnly`, `SameSite=Lax`, `Secure` cookies. Stored and queried in PostgreSQL exclusively as SHA-256 hashes (`sessionTokenHash`).
- **PostgreSQL Rate Limiting**: Enforced per-account in PostgreSQL with concurrency protection using interactive transactions and advisory locks.
- **Database Constraints**: Custom PostgreSQL CHECK constraint enforces that `Report` has exactly one of `postId` or `commentId` populated.
- **Test Database Isolation Guard**: Tests must define `TEST_DATABASE_URL` explicitly targeting `instapro_test` on dedicated port 5433 (`.local-test-db-data`). Tests strictly assert `current_database() === 'instapro_test'` and refuse to run or truncate if connected to any other database. Tests never fall back to `DATABASE_URL`.

## Database schema status
Authoritative Prisma schema with 12 models and 2 applied SQL migrations:
1. `20260903000000_init_with_report_check`:
   - Creates models: `User`, `Session`, `Community`, `Membership`, `CommunitySanction`, `Post`, `Comment`, `PostVote`, `CommentVote`, `Report`, `ModerationAction`, `RateLimitBucket`.
   - Adds custom PostgreSQL CHECK constraint `check_report_target_exactly_one` on `Report`: `(("postId" IS NOT NULL AND "commentId" IS NULL) OR ("postId" IS NULL AND "commentId" IS NOT NULL))`.
2. `20260904000000_drop_moderation_action_report_unique`:
   - Drops accidental unique index `ModerationAction_reportId_key`.
   - Adds non-unique index `ModerationAction_reportId_idx`, ensuring multiple append-only `ModerationAction` records (e.g. `REMOVE_POST` and `ISSUE_SANCTION`) can reference the same `Report`.

## Completed work
- Approved Phase 0 implementation plan and finalized architecture.
- Created `docs/PROJECT_CONTEXT.md` as cross-AI persistent record.
- Initialized Next.js 15 App Router project with TypeScript, Tailwind CSS, and strict configs.
- Added `docker-compose.yml` for PostgreSQL 16 with health check (`pg_isready`).
- Pinned `embedded-postgres` and `@embedded-postgres/windows-x64` to exact version `18.4.0-beta.17`.
- Applied migrations `20260903000000_init_with_report_check` and `20260904000000_drop_moderation_action_report_unique`.
- Configured isolated test harness on port 5433 targeting `instapro_test` with explicit assertion guards preventing any modification of the development database (`instapro`).
- Added `.env.example` and `.env` with `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET`, and `ALLOW_PUBLIC_REGISTRATION=false`.
- Added `README.md` documenting local setup, security gate, and database environments.
- Added minimal starter page (`src/app/page.tsx`) proving application runs.

## Verification performed
- `npx prisma validate`: Schema is valid 🚀.
- `npx prisma generate`: Generated Prisma Client (v6.19.3) in 160ms.
- `npm test` (`vitest run`): **2 test files, 9 tests passed** (11.60s total duration, 10.45s tests):
  - `safety-isolation.test.ts`:
    - Rejects test execution if `TEST_DATABASE_URL` targets development database `instapro`.
    - Rejects test execution if `TEST_DATABASE_URL` is undefined (refuses silent fallback).
  - `stage1-foundation.test.ts`:
    - Confirmed test database is `instapro_test` and not `instapro`.
    - Confirmed all 12 tables exist and are queryable.
    - Confirmed `Report` with `postId` only is accepted.
    - Confirmed `Report` with `commentId` only is accepted.
    - Confirmed `Report` with both targets is rejected by `check_report_target_exactly_one`.
    - Confirmed `Report` with zero targets is rejected by `check_report_target_exactly_one`.
    - Confirmed one `Report` can be linked to two separate `ModerationAction` records (`REMOVE_POST` and `ISSUE_SANCTION`) without unique index violations.
- Direct development database inspection: Verified development database `instapro` on port 5432 was untouched and not accessed by the test suite.
- `npm run build`: Production build succeeded in 1.0s, generating static routes (`/` and `/_not-found`).

## Current blockers / known limitations
- Docker Desktop is not installed on this host system. The repository includes standard `docker-compose.yml` for containerized environments and provides pinned `embedded-postgres` (`18.4.0-beta.17`) for Windows local development (`npm run db:local`) and isolated test runs (`npm test`).

## Immediate next task
Stage 2: Pseudonymous Authentication & SHA-256 Hashed Sessions:
- Implement lowercase username validation (`^[a-z0-9_]{3,24}$`).
- Implement 12-64 byte password validation and bcrypt hashing.
- Implement 256-bit raw session token generation with SHA-256 database storage (`Session.sessionTokenHash`) and `HttpOnly` cookie issuance.
- Implement registration and login Server Actions with `ALLOW_PUBLIC_REGISTRATION` check.
- Add unit/integration tests for auth flows against `instapro_test`.

## Handoff instructions
- Read this file before initiating any work.
- Maintain modular monolith boundaries in `src/features/`.
- Ensure all tests use `TEST_DATABASE_URL` targeting `instapro_test` and never touch `DATABASE_URL`.
- Update this document at the conclusion of every stage.

## Change log
- **2026-09-04**: Completed Stage 1 corrections. Created migration `20260904000000_drop_moderation_action_report_unique` removing accidental unique index on `ModerationAction.reportId`. Implemented test database isolation on port 5433 with `TEST_DATABASE_URL=".../instapro_test"`, adding database assertion checks. Pinned `embedded-postgres` to exact versions. Added multi-action report linkage test and isolation guard tests (9 of 9 tests passing). Set Stage 1 to Complete.
- **2026-09-04**: Initial Stage 1 implementation. Applied Prisma schema, created custom PostgreSQL Report CHECK constraint, configured Vitest with DB reset helper, built and tested production Next.js app.
- **2026-09-03**: Created `docs/PROJECT_CONTEXT.md` and initiated Stage 1.
