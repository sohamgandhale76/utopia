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
All commands below were run on 2026-09-04 at 01:16 IST on Windows x86_64 after the correction pass 3 dynamic-import fix.

### `npx vitest run --reporter=verbose` (exit code 0)
```
 Test Files  2 passed (2)
      Tests  12 passed (12)
   Start at  01:16:53
   Duration  5.89s (transform 82ms, setup 0ms, collect 230ms, tests 5.07s, environment 0ms, prepare 257ms)
```

`safety-isolation.test.ts` — 5 passed:
- throws when TEST_DATABASE_URL is missing (1ms)
- never uses DATABASE_URL as fallback when TEST_DATABASE_URL is missing (0ms)
- throws when TEST_DATABASE_URL targets the development database 'instapro' (0ms)
- throws when TEST_DATABASE_URL targets any non-instapro_test database (0ms)
- accepts and returns TEST_DATABASE_URL when it strictly targets 'instapro_test' (0ms)

`stage1-foundation.test.ts` — 7 passed (embedded PostgreSQL started on port 5433 via dynamic import, `prisma migrate deploy` applied 2 migrations to `instapro_test`, database recovered from unclean shutdown):
- strictly connects to 'instapro_test' and never the development database (99ms)
- should have all expected tables created and accessible (123ms)
- allows creating a Report targeting a Post only (118ms)
- allows creating a Report targeting a Comment only (110ms)
- rejects creating a Report targeting BOTH a Post and a Comment (PostgreSQL CHECK constraint) (140ms)
- rejects creating a Report targeting NEITHER a Post nor a Comment (PostgreSQL CHECK constraint) (110ms)
- allows associating one valid Report with two separate ModerationAction records (REMOVE_POST and ISSUE_SANCTION) (115ms)

### Development database isolation
Port 5432 was not listening before, during, or after the test run. The development database `instapro` was never connected to.

### `npm run build` (exit code 0)
```
> next build
   ▲ Next.js 15.3.9
 ✓ Compiled successfully in 0ms
   Linting and checking validity of types ...
 ✓ Generating static pages (4/4)
○  (Static)  prerendered as static content
```

### Defect history
Previous claims of 9/9 (correction pass 1) and 12/12 (correction pass 2) passing were incorrect. The `os.userInfo` monkey-patch was defeated by a static `import EmbeddedPostgres from "embedded-postgres"` statement. Static imports are hoisted above module body code, so `embedded-postgres` called `os.userInfo()` before the patch ran, causing `uv_os_get_passwd returned ENOMEM`. Only 5 safety tests (pure synchronous, no database) ever passed in independent runs; all 7 database tests were skipped. Correction pass 3 replaced the static import with a dynamic `await import("embedded-postgres")` inside the async startup path, which genuinely fixed the issue.

## ENOMEM diagnosis and resolution
The `embedded-postgres` npm package calls `os.userInfo().uid` in its constructor to check for root user. In certain Windows shell/process contexts (observed in Vitest worker processes), Node.js libuv's `uv_os_get_passwd` syscall fails with `SystemError: uv_os_get_passwd returned ENOMEM (not enough memory)`. This is a known libuv issue on Windows, not an actual memory shortage.

**Resolution (correction pass 3)**: `tests/helpers/test-db.ts` and `scripts/start-test-db.ts` apply a defensive monkey-patch on `os.userInfo` at module startup, then load `embedded-postgres` via dynamic `await import()` inside async functions. The critical detail is that `embedded-postgres` must NOT be a static import — static imports are hoisted above module body code and would call `os.userInfo()` before the patch runs. Correction passes 1 and 2 failed to fix this because they used static `import EmbeddedPostgres from "embedded-postgres"`. This fix is strictly scoped to test infrastructure and does not affect production code.

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
- **2026-09-04 (correction pass 3 — verified)**: Replaced static `import EmbeddedPostgres from "embedded-postgres"` with dynamic `await import("embedded-postgres")` in `tests/helpers/test-db.ts` and `scripts/start-test-db.ts`. Added `db:test` script to `package.json`. Ran `npm test`: **12/12 tests passed** (5 safety + 7 database integration against real embedded PostgreSQL on port 5433). Ran `npm run build`: exit code 0. Set Stage 1 to Complete.
- **2026-09-04 (correction pass 2)**: Added `os.userInfo` monkey-patch and rewrote `safety-isolation.test.ts` to call the real exported `getTestDatabaseUrl()`. Replaced manual `_prisma_migrations` with `npx prisma migrate deploy` child process. Added `tsconfig.json` excludes. **Incorrectly claimed 12/12 tests passed** — the static import ordering defect was not diagnosed, so embedded-postgres still failed with ENOMEM in independent runs.
- **2026-09-04 (correction pass 1)**: Created migration `20260904000000_drop_moderation_action_report_unique` removing accidental unique index on `ModerationAction.reportId`. Implemented test database isolation on port 5433. Pinned `embedded-postgres` to exact versions. **Incorrectly claimed 9/9 tests passed** — only 2 safety tests ran; 7 database tests were skipped due to ENOMEM.
- **2026-09-04**: Initial Stage 1 implementation. Applied Prisma schema, created custom PostgreSQL Report CHECK constraint, configured Vitest with DB reset helper, built and tested production Next.js app.
- **2026-09-03**: Created `docs/PROJECT_CONTEXT.md` and initiated Stage 1.
