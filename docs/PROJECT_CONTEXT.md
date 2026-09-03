# Project Context

## Project purpose
Building an open-source, pseudonymous, community-first social platform where users can be anonymous to each other, but not free from accountability. All content, feeds, scoring, and moderation actions are transparent, deterministic, and explainable.

## Current status
Stage 5: Voting, Reporting, Sanctions, Moderation Actions & Community Transparency — Complete
Stage 4: Content Foundation — Complete
Stage 3B: Community UI — Complete
Stage 3A: Community & Membership Backend — Complete
Stage 2: Pseudonymous Authentication & SHA-256 Hashed Sessions — Complete

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
- **PostgreSQL Rate Limiting**: Not implemented yet (planned for a future stage).
- **Database Constraints**: Custom PostgreSQL CHECK constraint enforces that `Report` has exactly one of `postId` or `commentId` populated.
- **Test Database Isolation Guard**: Tests must define `TEST_DATABASE_URL` explicitly targeting `instapro_test` on dedicated port 5433. Tests strictly assert `current_database() === 'instapro_test'` and refuse to run or truncate if connected to any other database. Tests never fall back to `DATABASE_URL`.

## Database schema status
Authoritative Prisma schema with 12 models and 4 applied SQL migrations:
1. `20260903000000_init_with_report_check`:
   - Creates models: `User`, `Session`, `Community`, `Membership`, `CommunitySanction`, `Post`, `Comment`, `PostVote`, `CommentVote`, `Report`, `ModerationAction`, `RateLimitBucket`.
   - Adds custom PostgreSQL CHECK constraint `check_report_target_exactly_one` on `Report`: `(("postId" IS NOT NULL AND "commentId" IS NULL) OR ("postId" IS NULL AND "commentId" IS NOT NULL))`.
2. `20260903213816_optimize_community_feed_index`:
   - Adds composite index `Post_communityId_isDeleted_createdAt_id_idx` on `Post(communityId, isDeleted, createdAt DESC, id DESC)` optimized for deterministic, keyset-paginated community feeds.
3. `20260904000000_drop_moderation_action_report_unique`:
   - Drops accidental unique index `ModerationAction_reportId_key`.
   - Adds non-unique index `ModerationAction_reportId_idx`, ensuring multiple append-only `ModerationAction` records (e.g. `REMOVE_POST` and `ISSUE_SANCTION`) can reference the same `Report`.
4. `20260904052000_partial_unique_pending_reports`:
   - Adds PostgreSQL partial unique index `Report_reporterId_postId_pending_unique` on `Report(reporterId, postId)` where `status = 'PENDING' AND postId IS NOT NULL`.
   - Adds PostgreSQL partial unique index `Report_reporterId_commentId_pending_unique` on `Report(reporterId, commentId)` where `status = 'PENDING' AND commentId IS NOT NULL`.
   - Enforces database-level uniqueness for pending reports while preserving application-level Serializable transaction deduplication.

## Completed work
- Approved Phase 0 implementation plan and finalized architecture.
- Created `docs/PROJECT_CONTEXT.md` as cross-AI persistent record.
- Initialized Next.js 15 App Router project with TypeScript, Tailwind CSS, and strict configs.
- Added `docker-compose.yml` for PostgreSQL 16 with health check (`pg_isready`).
- Pinned `@embedded-postgres/windows-x64` to exact version `18.4.0-beta.17` (used for pg_ctl/initdb binaries only).
- Applied migrations `20260903000000_init_with_report_check`, `20260903213816_optimize_community_feed_index`, `20260904000000_drop_moderation_action_report_unique`, and `20260904052000_partial_unique_pending_reports`.
- Configured isolated test harness requiring `TEST_DATABASE_URL` targeting `instapro_test` with `current_database()` assertion guards.
- Added `.env.example` and `.env` with `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET`, and `ALLOW_PUBLIC_REGISTRATION=false`.
- Added `README.md` documenting local setup, security gate, and database environments.
- Added minimal starter page (`src/app/page.tsx`) proving application runs.
- **Stage 2 (Auth)**: Implemented pseudonymous authentication (bcrypt 12 rounds), strictly validated username (`^[a-z0-9_]{3,24}$`) and password (min 12 chars, max 64 UTF-8 bytes).
- **Stage 2 (Auth)**: Implemented session management (256-bit cryptographically random tokens). The database stores only the SHA-256 `sessionTokenHash`. The client receives the raw token in an `HttpOnly`, `SameSite=Lax` cookie.
- **Stage 2 (Auth)**: Server Actions for `/register`, `/login`, and `logout` implemented. Registration strictly respects the `ALLOW_PUBLIC_REGISTRATION` feature flag.
- **Stage 2 (Auth Security Pass)**: Extracted core business logic to `service.ts` to allow direct integration testing via dependency injection of the Prisma client. Validated that suspended sessions are rejected/deleted, suspended accounts return identical generic errors on login, and concurrent registration races are handled safely using the Prisma Unique Constraint error instead of check-then-insert.
- **Stage 2 (Privacy & Type-Safety Pass)**: Defined explicit safe result types in `service.ts` (`AuthUserSummary` and `SafeSessionUser`). Completely removed `as User` casts. `passwordHash` is never exposed or returned from `registerUser`, `verifyCredentials`, or `validateSessionToken`. Updated registration page helper text to clarify maximum 64 UTF-8 bytes.
- **Stage 3A (Communities Backend)**: Implemented server-independent community domain logic with Zod validation.
- **Stage 3A (Communities Backend)**: Created atomic, Serializable Prisma transactions with bounded P2034 retries for concurrent `leaveCommunity` and `transferOwnership` actions. Handled duplicate unique constraints safely.
- **Stage 3A (Communities Backend)**: Implemented thin Server Actions wrapping the service layer.
- **Stage 3A (Communities Backend)**: Updated `package.json` to run tests sequentially (`--no-file-parallelism`) to prevent global database truncation hooks from corrupting concurrent Vitest files.
- **Stage 3B (Community UI)**: Implemented public community directory (`/c`) with name, slug, description, and member counts. Member rosters and usernames are strictly hidden.
- **Stage 3B (Community UI)**: Implemented authenticated community creation route (`/c/create`) as a server-side authenticated route redirecting signed-out visitors to `/login`, wrapping the interactive `CreateCommunityForm` client component with visible validation and safe redirect to `/c/[slug]`.
- **Stage 3B (Community UI)**: Extended `createCommunityAction` to return only safe redirect data (`{ id, slug }`).
- **Stage 3B (Community UI)**: Implemented public community detail page (`/c/[slug]`) and 404 page (`/c/[slug]/not-found.tsx`), displaying description, plain-text rules, and member counts.
- **Stage 3B (Community UI)**: Built client-side `MembershipButton` component for Join/Leave interactions. Join/Leave derives user identity strictly from the server session and calls `router.refresh()` on completion; client never sends user IDs.
- **Stage 3B (Community UI)**: Added safe read helpers `listPublicCommunities` (ordered by `createdAt` descending) and `getViewerMembership` (exposing only the current viewer's membership record).
- **Stage 4 (Content Foundation)**: Implemented posts, comments, and chronological community feeds. Public reads select only safe author fields (`id`, `username`) and never leak `role` or sensitive attributes. Post and comment creation are verified against community membership and wrapped in Serializable transactions with bounded P2034 retries. Comment creation verifies parent post existence, enforces `isDeleted: false` guard, and checks max reply depth (5). Feeds use deterministic keyset pagination with a Zod-validated base64url opaque cursor, exact `(createdAt, id)` predicate, and server-side limit validation (finite integer 1-100, default 50).
- **Stage 5 (Voting, Reporting, Sanctions, Moderation Actions & Community Transparency)**:
  - Voting: Implemented post and comment voting (`castPostVote`, `castCommentVote`) with unbounded score calculation (`upvotes - downvotes`), duplicate vote invariants via database unique constraints, concurrency-safe Serializable transactions with retry, and toggle unvoting.
  - Reporting: Implemented single-target post/comment reporting validated against database CHECK constraint, pending report deduplication, muted/banned user rules (muted can report, banned cannot), and private moderator queue (`listCommunityReports`). Reporter identities and report reasons are strictly private.
  - Sanctions: Implemented `MUTE` (blocks post/comment/vote) and `BAN` (blocks post/comment/vote/report/join) issuance with dynamic expiry, revocation, role hierarchy enforcement (mod cannot sanction mod/owner; owner immune; no self-sanction/revocation), and join-bypass prevention (banned user cannot rejoin after leaving).
  - Moderation Actions: Implemented append-only audit logging (`logModerationAction`) without application-level update/delete paths. Implemented content removal (`removePost`, `removeComment`) with soft deletion, report status updates (`ACTIONED`, `DISMISSED`), and compensating action creation.
  - Public Transparency: Implemented community-scoped `/c/[slug]/modlog` route with strict projections masking target pseudonyms on sanctions ("Sanctioned a member"), omitting author pseudonyms on removals, and strictly omitting internal notes and reporter reasons.
  - UI: Built interactive `VoteControls` (optimistic state), `ReportModal` (private reason input), `ModeratorControls` (removal & sanctioning modal), and community moderation log page (`/c/[slug]/modlog`).

## Verification performed
### Independently verified
- `npm test`: 110/110 tests pass successfully across 10 test files (5 safety isolation tests, 7 foundation database tests, 32 authentication tests, 22 community tests, 10 content foundation tests, 8 voting tests, 12 reporting tests, 6 sanction tests, 6 moderation tests, and 2 modlog transparency tests).
- `npm run db:test`: Background PostgreSQL 18.4 daemon successfully running on port 5433 using `pg_ctl`. The `start-test-db.ts` script correctly keeps the process alive via `setInterval`.
- `npm run build`: Production Next.js build succeeds with 0 errors (Code 0), compiling static and dynamic routes (`/`, `/c`, `/c/create`, `/c/[slug]`, `/c/[slug]/modlog`, `/c/[slug]/post/[postId]`, `/c/[slug]/post/create`, `/login`, `/register`). PostgreSQL 16 compatibility remains a pre-deployment check.

## ENOMEM diagnosis and resolution
The `embedded-postgres` npm package (JS wrapper) uses a named import internally:
```js
import { userInfo } from "os";
```

On this Windows host, Node.js libuv's `uv_os_get_passwd` syscall fails with `SystemError: uv_os_get_passwd returned ENOMEM`. This is a known libuv issue on Windows, not an actual memory shortage.

**Why monkey-patching os.userInfo does not work**: ES module named imports (`import { userInfo } from "os"`) bind directly to the exported function at import time. Reassigning `os.userInfo` in our code does not affect the already-bound `userInfo` variable inside `embedded-postgres`. This is fundamental to ES module semantics and cannot be worked around from outside the package.

**Resolution (correction pass 4)**: The `embedded-postgres` JS wrapper is no longer imported or used anywhere. Instead:
- `scripts/start-test-db.ts` invokes `pg_ctl.exe` and `initdb.exe` from `@embedded-postgres/windows-x64/native/bin/` directly as child processes — completely bypassing the JS wrapper. It uses `setInterval` to stay alive and prevent Windows from killing the child process.
- `tests/helpers/test-db.ts` requires an externally running PostgreSQL on the test port. If port 5433 is not open, it throws a clear error with instructions.

The `@embedded-postgres/windows-x64` package is retained as a devDependency solely for its bundled PostgreSQL binaries (pg_ctl, initdb, postgres).

## How to run tests

### Step 1: Start the test database
```powershell
npm run db:test
```
This uses `pg_ctl` to start PostgreSQL on port 5433 with data in `.local-test-db-data/` and creates the `instapro_test` database if it does not exist. (Keep this running in the background or in a separate terminal).

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
- **embedded-postgres JS wrapper unusable**: The wrapper's `import { userInfo } from "os"` triggers `ENOMEM` on this Windows host. The wrapper is not used; only the bundled PostgreSQL binaries are used via `pg_ctl` directly.
- `tsconfig.json` excludes `scripts/` and `tests/` from Next.js type-checking since those are executed by `tsx` and `vitest` respectively.

## Immediate next task
Stage 6 planning: Search, notifications, or direct messaging architecture (as defined by roadmap). No future-stage features started.

## Handoff instructions
- Read this file before initiating any work.
- Maintain modular monolith boundaries in `src/features/`.
- Ensure all tests use `TEST_DATABASE_URL` targeting `instapro_test` and never touch `DATABASE_URL`.
- Start the test database with `npm run db:test` before running `npm test`. (It may take ~30 seconds for crash recovery if it was shut down improperly).
- Update this document at the conclusion of every stage.

## Change log
- **2026-09-04 (Stage 5 — Voting, Reporting, Sanctions, Moderation Actions & Community Transparency)**: Complete. Implemented 5 domain feature modules under `src/features/` (`votes`, `reports`, `sanctions`, `moderation`). Built post & comment voting with dynamic unbounded scoring and toggle unvoting. Built post & comment reporting with single-target DB CHECK validation, pending deduplication, and database-level partial unique indexes (`20260904052000_partial_unique_pending_reports`) for pending post/comment reports. Built MUTE and BAN sanction issuance with dynamic expiry, revocation, hierarchy enforcement, and leave/rejoin bypass prevention. Built append-only moderation action audit logging without update/delete paths. Implemented community-scoped public moderation transparency (`/c/[slug]/modlog`) masking target pseudonyms and strictly omitting reporter data and internal notes. Added 34 new integration tests across 5 new test files. Verified 110/110 tests pass and Next.js production build succeeds with 0 errors.
- **2026-09-04 (Stage 4 Final Accuracy & Validation Pass)**: Complete. Validated `getCommunityFeed` limit server-side (finite integer 1-100, default 50) using `feedLimitSchema` and integrated `feedCursorSchema` to eliminate dead validation code. Added focused test for out-of-range/invalid feed limits. Truthfully documented 3 applied migrations, corrected rate limiting status, and verified 76/76 passing integration tests and successful Next.js production build.
- **2026-09-04 (Stage 4 Correction Pass)**: Complete. Implemented optimized index for community feed, extracted global role from public responses, wrapped content creation in Serializable transactions with P2034 retries, prevented commenting on deleted posts, and upgraded keyset pagination to a Zod-validated opaque base64 string cursor. Added new concurrency and boundaries tests. All 75 tests pass and production build succeeds.
- **2026-09-04 (Stage 3B)**: Completed Community UI. Built `/c` (public directory), `/c/create` (authenticated server route redirecting unauthenticated requests to `/login` wrapping `CreateCommunityForm`), and `/c/[slug]` (detail page with rules and membership interactions). Implemented `MembershipButton` with `router.refresh()`. Added safe read helpers `listPublicCommunities` and `getViewerMembership`. Added 3 integration tests verifying directory query privacy, viewer membership isolation, and safe redirect data. All 66/66 tests and Next.js production build pass.
- **2026-09-04 (Stage 3A)**: Completed Community & Membership backend logic. Implemented Serializable transactions for role transitions, strictly verified Zod input, and added 19 integration tests proving concurrency bounds. Disabled file parallelism in `vitest` to prevent concurrent database resets.
- **2026-09-04 (Stage 2 privacy & type-safety pass)**: Defined explicit safe result types in `service.ts` (`AuthUserSummary` and `SafeSessionUser`). Removed `as User` cast. Verified `passwordHash` is never returned or leaked from any auth service functions. Corrected registration helper text for 64 UTF-8 bytes limit. 44/44 tests and production build passing.
- **2026-09-04**: Completed Stage 2 (Auth). Fixed test database orchestration so `npm run db:test` keeps Node event loop alive (via `setInterval`) to prevent Windows from terminating the PostgreSQL child process. Tests and build passed.
- **2026-09-04 (correction pass 4)**: Removed ineffective `os.userInfo` monkey-patches from `tests/helpers/test-db.ts` and `scripts/start-test-db.ts`. Root cause: `embedded-postgres` uses `import { userInfo } from "os"` (named import binding), which is immutable from outside the module — `os.userInfo` reassignment has no effect. Removed all `embedded-postgres` JS wrapper usage. Rewrote `scripts/start-test-db.ts` to invoke `pg_ctl.exe` and `initdb.exe` directly. Added `scripts/stop-test-db.ts` and `db:test:stop` script. Test harness now requires external PostgreSQL. Stage 1 set to Blocked pending verification.
- **2026-09-04 (correction pass 3)**: Replaced static import with dynamic `await import("embedded-postgres")`. **Still failed** — the named import `{ userInfo }` inside `embedded-postgres` binds directly and is not affected by `os.userInfo` reassignment.
- **2026-09-04 (correction pass 2)**: Added `os.userInfo` monkey-patch with static import. **Failed** — static imports hoist above module body. Rewrote safety tests to call real `getTestDatabaseUrl()`. Replaced manual `_prisma_migrations` with `prisma migrate deploy`. Added `tsconfig.json` excludes.
- **2026-09-04 (correction pass 1)**: Created migration `20260904000000_drop_moderation_action_report_unique`. Implemented test database isolation on port 5433. Pinned `embedded-postgres` to exact versions. **Incorrectly claimed 9/9 tests passed.**
- **2026-09-04**: Initial Stage 1 implementation.
- **2026-09-03**: Created `docs/PROJECT_CONTEXT.md` and initiated Stage 1.

