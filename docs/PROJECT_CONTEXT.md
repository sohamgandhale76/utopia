# Project Context

## Project purpose
Building an open-source, pseudonymous, community-first social platform where users can be anonymous to each other, but not free from accountability. All content, feeds, scoring, and moderation actions are transparent, deterministic, and explainable.

## Current status
Stage 1: Core Foundation and Custom Migrations — Blocked (requires externally running PostgreSQL 16 on port 5433 for test verification)

## Approved architecture
- **Framework**: Next.js 15 App Router (React 19, TypeScript)
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL 16 via Prisma ORM
- **Database Infrastructure**:
  - Preferred / authoritative: Docker Compose (`docker-compose.yml` with health checks) or native PostgreSQL 16 server.
  - Local Windows test database: PostgreSQL binaries from `@embedded-postgres/windows-x64` are used via `pg_ctl` and `initdb` directly. The `embedded-postgres` JS wrapper is **not used** due to an unfixable `uv_os_get_passwd ENOMEM` bug (see below). Never for production.
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
- **Test Database Isolation Guard**: Tests must define `TEST_DATABASE_URL` explicitly targeting `instapro_test` on dedicated port 5433. Tests strictly assert `current_database() === 'instapro_test'` and refuse to run or truncate if connected to any other database. Tests never fall back to `DATABASE_URL`.

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
- Pinned `@embedded-postgres/windows-x64` to exact version `18.4.0-beta.17` (used for pg_ctl/initdb binaries only).
- Applied migrations `20260903000000_init_with_report_check` and `20260904000000_drop_moderation_action_report_unique`.
- Configured isolated test harness requiring `TEST_DATABASE_URL` targeting `instapro_test` with `current_database()` assertion guards.
- Added `.env.example` and `.env` with `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET`, and `ALLOW_PUBLIC_REGISTRATION=false`.
- Added `README.md` documenting local setup, security gate, and database environments.
- Added minimal starter page (`src/app/page.tsx`) proving application runs.

## Verification performed
### Independently verified
- `safety-isolation.test.ts`: 5 tests pass (pure synchronous, no database required).
- `stage1-foundation.test.ts`: all 7 database tests are **not yet verified** — they require an externally running PostgreSQL on port 5433.
- `npm run build`: not yet re-run pending test verification.

### Not yet run
Full suite (`npm test`) and production build (`npm run build`) have not been verified with the correction pass 4 changes. Previous claims of 9/9 and 12/12 passing were incorrect (see Defect history below).

## ENOMEM diagnosis and resolution
The `embedded-postgres` npm package (JS wrapper) uses a named import internally:
```js
import { userInfo } from "os";
```

On this Windows host, Node.js libuv's `uv_os_get_passwd` syscall fails with `SystemError: uv_os_get_passwd returned ENOMEM`. This is a known libuv issue on Windows, not an actual memory shortage.

**Why monkey-patching os.userInfo does not work**: ES module named imports (`import { userInfo } from "os"`) bind directly to the exported function at import time. Reassigning `os.userInfo` in our code does not affect the already-bound `userInfo` variable inside `embedded-postgres`. This is fundamental to ES module semantics and cannot be worked around from outside the package.

**Resolution (correction pass 4)**: The `embedded-postgres` JS wrapper is no longer imported or used anywhere. Instead:
- `scripts/start-test-db.ts` invokes `pg_ctl.exe` and `initdb.exe` from `@embedded-postgres/windows-x64/native/bin/` directly as child processes — completely bypassing the JS wrapper.
- `tests/helpers/test-db.ts` requires an externally running PostgreSQL on the test port. If port 5433 is not open, it throws a clear error with instructions.

The `@embedded-postgres/windows-x64` package is retained as a devDependency solely for its bundled PostgreSQL binaries (pg_ctl, initdb, postgres).

## How to run tests

### Step 1: Start the test database
```powershell
npm run db:test
```
This uses `pg_ctl` to start PostgreSQL on port 5433 with data in `.local-test-db-data/` and creates the `instapro_test` database if it does not exist.

### Step 2: Run the test suite
```powershell
npm test
```

### Step 3: Stop the test database (when done)
```powershell
npm run db:test:stop
```

### Alternative: Use your own PostgreSQL 16 server
If `npm run db:test` fails or you prefer a standalone installation:

1. Install PostgreSQL 16 from https://www.postgresql.org/download/windows/
2. During installation or afterwards, configure a server on **port 5433** (not the default 5432, which is reserved for the development database).
3. Create the test database:
   ```sql
   CREATE DATABASE instapro_test;
   ```
4. Ensure the connection string in `.env` matches:
   ```
   TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/instapro_test?schema=public"
   ```
5. Run `npm test`.

## Current blockers / known limitations
- **Test database not running**: Stage 1 cannot be verified complete until PostgreSQL is running on port 5433 with `instapro_test` available. Run `npm run db:test` first.
- **embedded-postgres JS wrapper unusable**: The wrapper's `import { userInfo } from "os"` triggers `ENOMEM` on this Windows host. The wrapper is not used; only the bundled PostgreSQL binaries are used via `pg_ctl` directly.
- `tsconfig.json` excludes `scripts/` and `tests/` from Next.js type-checking since those are executed by `tsx` and `vitest` respectively.

## Immediate next task
Verify Stage 1:
1. Run `npm run db:test` to start PostgreSQL on port 5433.
2. Run `npm test` — expect 12/12 tests passing.
3. Run `npm run build` — expect exit code 0.
4. If all pass, update this file to set Stage 1 to Complete with exact results.

Then Stage 2: Pseudonymous Authentication & SHA-256 Hashed Sessions.

## Handoff instructions
- Read this file before initiating any work.
- Maintain modular monolith boundaries in `src/features/`.
- Ensure all tests use `TEST_DATABASE_URL` targeting `instapro_test` and never touch `DATABASE_URL`.
- Start the test database with `npm run db:test` before running `npm test`.
- Update this document at the conclusion of every stage.

## Change log
- **2026-09-04 (correction pass 4)**: Removed ineffective `os.userInfo` monkey-patches from `tests/helpers/test-db.ts` and `scripts/start-test-db.ts`. Root cause: `embedded-postgres` uses `import { userInfo } from "os"` (named import binding), which is immutable from outside the module — `os.userInfo` reassignment has no effect. Removed all `embedded-postgres` JS wrapper usage. Rewrote `scripts/start-test-db.ts` to invoke `pg_ctl.exe` and `initdb.exe` directly. Added `scripts/stop-test-db.ts` and `db:test:stop` script. Test harness now requires external PostgreSQL. Stage 1 set to Blocked pending verification.
- **2026-09-04 (correction pass 3)**: Replaced static import with dynamic `await import("embedded-postgres")`. **Still failed** — the named import `{ userInfo }` inside `embedded-postgres` binds directly and is not affected by `os.userInfo` reassignment.
- **2026-09-04 (correction pass 2)**: Added `os.userInfo` monkey-patch with static import. **Failed** — static imports hoist above module body. Rewrote safety tests to call real `getTestDatabaseUrl()`. Replaced manual `_prisma_migrations` with `prisma migrate deploy`. Added `tsconfig.json` excludes.
- **2026-09-04 (correction pass 1)**: Created migration `20260904000000_drop_moderation_action_report_unique`. Implemented test database isolation on port 5433. Pinned `embedded-postgres` to exact versions. **Incorrectly claimed 9/9 tests passed.**
- **2026-09-04**: Initial Stage 1 implementation.
- **2026-09-03**: Created `docs/PROJECT_CONTEXT.md` and initiated Stage 1.
