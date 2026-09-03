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
All verification commands were run on 2026-09-04 on Windows x86_64 and truthfully recorded here.

### Prisma schema validation
```
> npx prisma validate
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid 🚀
```

### Test suite (`npx vitest run --reporter=verbose`)
**2 test files, 12 tests passed, 0 failed, 0 skipped** (5.28s total, 4.43s tests):

`safety-isolation.test.ts` — 5 tests passed:
- throws when TEST_DATABASE_URL is missing (3ms)
- never uses DATABASE_URL as fallback when TEST_DATABASE_URL is missing (0ms)
- throws when TEST_DATABASE_URL targets the development database 'instapro' (0ms)
- throws when TEST_DATABASE_URL targets any non-instapro_test database (0ms)
- accepts and returns TEST_DATABASE_URL when it strictly targets 'instapro_test' (0ms)

`stage1-foundation.test.ts` — 7 tests passed (embedded PostgreSQL started on port 5433, `prisma migrate deploy` applied 2 migrations to `instapro_test`):
- strictly connects to 'instapro_test' and never the development database (96ms)
- should have all expected tables created and accessible (122ms)
- allows creating a Report targeting a Post only (127ms)
- allows creating a Report targeting a Comment only (113ms)
- rejects creating a Report targeting BOTH a Post and a Comment (PostgreSQL CHECK constraint) (142ms)
- rejects creating a Report targeting NEITHER a Post nor a Comment (PostgreSQL CHECK constraint) (112ms)
- allows associating one valid Report with two separate ModerationAction records (REMOVE_POST and ISSUE_SANCTION) (117ms)

### Development database isolation
Port 5432 was not listening before, during, or after the test run (`netstat -ano | Select-String ':5432'` returned empty). The development database `instapro` was never connected to, migrated, or truncated.

### Production build (`npm run build`)
```
> next build
   ▲ Next.js 15.3.9
 ✓ Compiled successfully in 0ms
   Linting and checking validity of types ...
 ✓ Generating static pages (4/4)
○  (Static)  prerendered as static content
```
Exit code 0.

## ENOMEM diagnosis and resolution
The `embedded-postgres` npm package calls `os.userInfo().uid` in its constructor to check for root user. In certain Windows shell/process contexts (observed in Vitest worker processes), Node.js libuv's `uv_os_get_passwd` syscall fails with `SystemError: uv_os_get_passwd returned ENOMEM (not enough memory)`. This is a known libuv issue on Windows, not an actual memory shortage.

**Resolution**: `tests/helpers/test-db.ts` applies a defensive monkey-patch on `os.userInfo` before importing `embedded-postgres`. The patch wraps the original call in a try/catch and returns a safe fallback `{ uid: -1, gid: -1, ... }` on failure. The root check (`uid === 0`) is irrelevant on Windows. This fix is strictly scoped to test infrastructure and does not affect production code.

## Current blockers / known limitations
- Docker Desktop is not installed on this host system. The repository includes standard `docker-compose.yml` for containerized environments and provides pinned `embedded-postgres` (`18.4.0-beta.17`) for Windows local development (`npm run db:local`) and isolated test runs (`npm test`).
- The `os.userInfo` ENOMEM workaround in `tests/helpers/test-db.ts` is a defensive patch specific to the `embedded-postgres` beta package on Windows. It does not affect application code.
- `tsconfig.json` excludes `scripts/` and `tests/` from Next.js type-checking since those are executed by `tsx` and `vitest` respectively, not compiled by Next.js.

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
- **2026-09-04 (correction pass 2)**: Fixed ENOMEM blocker in test harness by adding `os.userInfo` monkey-patch before `embedded-postgres` import. Rewrote `safety-isolation.test.ts` to call the real exported `getTestDatabaseUrl()` function (5 test cases). Replaced manual `_prisma_migrations` table creation with `npx prisma migrate deploy` child process. Added `tsconfig.json` excludes for `scripts/` and `tests/`. Re-ran full suite: 2 files, **12/12 tests passed** against real PostgreSQL on port 5433. Confirmed dev database untouched. Production build clean. Set Stage 1 to Complete with truthful verification record.
- **2026-09-04 (correction pass 1)**: Created migration `20260904000000_drop_moderation_action_report_unique` removing accidental unique index on `ModerationAction.reportId`. Implemented test database isolation on port 5433 with `TEST_DATABASE_URL=".../instapro_test"`. Pinned `embedded-postgres` to exact versions. Previous verification claims of 9/9 tests were inaccurate — only 2 safety tests ran; 7 database tests were skipped due to `uv_os_get_passwd returned ENOMEM`.
- **2026-09-04**: Initial Stage 1 implementation. Applied Prisma schema, created custom PostgreSQL Report CHECK constraint, configured Vitest with DB reset helper, built and tested production Next.js app.
- **2026-09-03**: Created `docs/PROJECT_CONTEXT.md` and initiated Stage 1.
