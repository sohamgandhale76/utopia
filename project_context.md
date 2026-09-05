# Utopia — Project Context

## 1. Project Overview
**Utopia** is an open-source, pseudonymous, community-first social platform engineered for privacy, honest discourse, and user sovereignty.

### Core Tenets:
- **Strict Pseudonymity & Zero PII:** No real names, email addresses, phone numbers, or third-party OAuth providers. Users authenticate with a pseudonymous handle and password only.
- **Account Recovery Tradeoff:** Without emails or recovery tokens, account recovery is deliberately impossible if credentials are lost.
- **Public Community Reads:** All communities, posts, and comments are publicly viewable without authentication.
- **Membership Required for Participation:** Creating posts, posting comments, voting, and submitting reports strictly require joining the respective community.
- **Hidden Member Rosters:** Aggregate community member counts are public, but member rosters/usernames are strictly hidden from non-moderators to eliminate user profiling and mass scraping.
- **Plain-Text Content:** Posts and comments are strictly plain text (zero Markdown or raw HTML rendering; whitespace preserved via CSS `whitespace-pre-wrap`), eliminating stored XSS vectors.
- **Mutual Accountability:** Moderation actions (content removal, sanctions) are logged in an append-only public transparency log (ModLog) displaying the acting moderator's pseudonym and reason.

---

## 2. Architecture
Utopia is structured as a **modular monolith** organized by feature domains under `src/features/`.

```
src/
├── app/                  # Next.js 15 App Router pages, layouts, and server actions
│   ├── (auth)/login/     # Login UI
│   ├── (auth)/register/  # Registration UI
│   ├── c/                # Community directory & creation
│   │   ├── [slug]/       # Community feed & post view
│   │   └── create/       # Authenticated community creation
│   ├── search/           # Global search (communities, posts, users)
│   └── u/[username]/     # Pseudonymous public profile view
├── features/             # Modular feature domains
│   ├── auth/             # Password hashing (Argon2id), sessions, rate limiting
│   ├── communities/      # Community domain logic, memberships, roles, permissions
│   ├── content/          # Posts, comments, threading, plain-text validation
│   ├── votes/            # Post/comment voting, atomic score aggregation
│   ├── reports/          # Content reporting, moderation queue
│   ├── moderation/       # Content removals, ModLog audit trail
│   ├── sanctions/        # Community-level MUTE and BAN enforcement
│   ├── profiles/         # Public pseudonymous profiles & user history
│   ├── search/           # PostgreSQL FTS, ILIKE prefix search, pagination
│   └── feed/             # Home and discovery feed domain (types & validation)
└── lib/                  # Shared infrastructure
    ├── db.ts             # PrismaClient singleton
    └── transaction.ts    # Serializable retry wrapper (executeWithRetry)
```

### Architectural Patterns:
- **Server-Derived Identity:** Client form data and request bodies NEVER determine authenticated user ID or roles. The active identity is strictly derived from the validated cryptographic session via `requireUser()`.
- **Serializable PostgreSQL Transactions:** Multi-row mutations (leaving communities, transferring ownership, voting) execute inside `executeWithRetry()` using PostgreSQL `Serializable` transactions to eliminate race conditions and lost updates.
- **Dual-Layer Rate Limiting:** In-process hardware protection (concurrency semaphore + LRU burst limiter) protects authentication before PostgreSQL writes, preserving database connection pool capacity.

---

## 3. Technology Stack
- **Framework:** Next.js 15.3.9 (App Router)
- **React:** React 19.0.0 (Server & Client Components)
- **Language:** TypeScript 5.7.3 (Strict Mode enabled)
- **Styling:** Tailwind CSS 3.4.17
- **Database:** PostgreSQL 16 (Development on port 5432; Isolated Test Database `instapro_test` on port 5433)
- **ORM:** Prisma 6.4.1
- **Password Hashing:** `argon2` v0.45.1 (Canonical Argon2id) with `bcryptjs` v2.4.3 retained solely for login-time legacy rehash migration
- **Validation:** Zod 3.24.2
- **Testing:** Vitest 3.0.7 (Executed strictly with `--no-file-parallelism`)

---

## 4. Security & Privacy Model
1. **Password Security:** Argon2id with memoryCost: 65536 KiB, timeCost: 3 iterations, parallelism: 4 threads, version: 19, and 16-byte random salts. Password lengths are restricted to 12–64 UTF-8 bytes to eliminate DoS memory exhaustion on memory-hard algorithms.
2. **Session Security:** 256-bit cryptographically secure random session tokens (`crypto.randomBytes(32)`). Stored and queried in PostgreSQL exclusively as SHA-256 hashes (`sessionTokenHash`). Raw tokens transmitted in `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookies.
3. **Login Resource-Exhaustion Protection (SEC-01):**
   - In-process concurrency circuit breaker hard-capping active password verifications to 4 concurrent operations per Node.js process.
   - Bounded in-memory IP burst limiter (5 requests / 10 seconds / IP) with $O(1)$ LRU eviction (10,000 entries max).
   - Per-`(IP, username)` failure limiter (5 failed attempts / 15 minutes) preventing credential guessing without locking out legitimate users from other IPs.
   - Reverse-proxy forwarding headers (`X-Forwarded-For`, `X-Real-IP`) are untrusted by default unless `TRUST_PROXY=true` is explicitly set.
4. **Zero XSS Sinks:** No `dangerouslySetInnerHTML`, `innerHTML`, or `eval()`. Plain text rendered directly via React JSX with CSS whitespace preservation.
5. **Sanction Enforcement:** Banned or muted users are blocked at the service layer from posting, commenting, voting, or joining.
6. **Registration Abuse Gate:** Public registration gated by `ALLOW_PUBLIC_REGISTRATION=false` until proof-of-work or CAPTCHA is implemented.

---

## 5. Development Rules / Non-Negotiable Constraints
- **Test Database Isolation:** All tests MUST use `getTestPrisma()` from `tests/helpers/test-db.ts` requiring `TEST_DATABASE_URL` targeting `instapro_test` on port 5433. Tests assert `current_database() === 'instapro_test'` and will refuse to run or truncate any other database. Tests must NEVER fall back to `DATABASE_URL`.
- **Sequential Test Execution:** Always run tests with `vitest --no-file-parallelism` or `npm test` to prevent parallel truncation conflicts across test files.
- **No Client-Supplied Identity:** Never accept `userId` or `actorId` from client request bodies or forms for authorization. Always derive identity via `requireUser()`.
- **Safe Type Serialization:** Never expose or serialize `passwordHash`, raw session tokens, or internal moderation metadata in public selectors or Server Action return objects.
- **No Unsafe Raw SQL:** All raw database queries must use Prisma parameterization (`$queryRaw`) and escape LIKE/ILIKE wildcards (`%`, `_`).

---

## 6. Completed Stages
- **Stage 1 — Foundation & Isolation:** Next.js App Router setup, Prisma schema, PostgreSQL Docker container, custom test harness with database isolation assertions.
- **Stage 2 — Pseudonymous Authentication:** Signup, login, session issuance, safe type returns, suspended-user rejection, Argon2id migration, and SEC-01 rate-limit protection.
- **Stage 3A & 3B — Communities:** Community creation, public directory (`/c`), public detail page (`/c/[slug]`), atomic join/leave transactions, sole-owner transfer protection, role management, hidden member rosters.
- **Stage 4 — Content Foundation:** Plain-text posts, comments, threading, community membership enforcement, post deletion, parent post validation.
- **Stage 5 — Moderation, Sanctions, Reports & ModLog:** Content reporting with PostgreSQL partial unique indexes, post/comment removals, community sanctions (MUTE/BAN), and public append-only ModLog.
- **Stage 6A — Responsive Layout & Branding:** Responsive navigation shell, global search input, Utopia branding.
- **Stage 6 Phase 1 — Pseudonymous Public Profiles:** User profile route `/u/[username]`, tabbed overview/posts/comments, privacy filtering for deleted content and suspended accounts.

---

## 7. Current Stage / Phase
**Stage 6 — Discovery, Search, Feed & Polish**

| Phase | Description | Status | Verification |
|---|---|---|---|
| **Phase 1** | Pseudonymous Public Profiles | **COMPLETED** | Committed in `c84c8cb` |
| **Phase 2** | Full-Text & Prefix Search | **COMPLETED & AUDITED** | 19 integration tests passing (`search.test.ts`) |
| **Phase 3** | Home & Discovery Feed | **IN PROGRESS** | Domain types and validation schemas defined |
| **Phase 4** | In-App Notifications | **NOT STARTED** | Planned |
| **Phase 5** | Release Gate & UX Polish | **NOT STARTED** | Planned |

---

## 8. Authentication & Security Status
- **Password Hasher:** Argon2id ($m=65536\text{ KiB}$, $t=3$, $p=4$, $v=19$, 16-byte random salt).
- **Legacy Migration:** Transparent verification and rehashing of legacy bcrypt hashes on successful login.
- **Rate Limiting (SEC-01):**
  - Concurrency Semaphore: max 4 active verifications per process.
  - IP Burst Limiter: 5 req / 10s / IP with LRU eviction.
  - Failure Throttle: 5 failed attempts / 15 min per `(IP, username)`.
  - Non-existent usernames return generic error immediately without Argon2 computation.
- **Audit Verdict:** `SEC-01 FINAL AUDIT: PASS WITH HARDENING` (0 critical, 0 high findings).

---

## 9. Search Status
- **Location:** `src/features/search/service.ts`, `src/features/search/validation.ts`, `src/app/search/page.tsx`
- **Capabilities:**
  - Community search: PostgreSQL FTS on name and description with fallback prefix/exact matching.
  - Post search: PostgreSQL FTS on title and body, filtering `isDeleted: false` and excluding suspended authors. Cursor pagination enabled.
  - User search: Prefix matching on `username` for non-suspended accounts.
  - Wildcard Escaping: LIKE/ILIKE wildcards escaped using `#` escape syntax (`LIKE '%foo#%%' ESCAPE '#'`).
  - Indexes: GIN expression indexes applied via migration `20260904150045_add_search_indexes`.

---

## 10. Feed Status
- **Location:** `src/features/feed/types.ts`, `src/features/feed/validation.ts`
- **Current State:**
  - Defined `FeedType` (`"home"`, `"community"`, `"all"`), `FeedSort` (`"newest"`, `"top"`, `"hot"`), and `FeedItem` interfaces.
  - Defined Zod validation schemas for feed queries.
  - **Pending:** Feed query service (`service.ts`), ranking calculations, and Home feed page (`src/app/page.tsx`).

---

## 11. Notifications Status
- **Current State:** NOT STARTED.
- Planned for Stage 6 Phase 4.

---

## 12. Testing Status
- **Test Runner:** Vitest 3.0.7
- **Total Tests:** **187 passing tests across 13 test files (0 failures)**
- **Test Files Breakdown:**
  1. `tests/integration/auth.test.ts` (43 tests) — Auth & session security
  2. `tests/integration/auth-rate-limit.test.ts` (23 tests) — SEC-01 rate limiting & concurrency
  3. `tests/integration/profiles.test.ts` (24 tests) — Public profiles & privacy
  4. `tests/integration/community.test.ts` (22 tests) — Communities & memberships
  5. `tests/integration/search.test.ts` (19 tests) — FTS & prefix search
  6. `tests/integration/reports.test.ts` (12 tests) — Content reporting
  7. `tests/integration/content.test.ts` (10 tests) — Posts & comments
  8. `tests/integration/votes.test.ts` (8 tests) — Voting & scores
  9. `tests/integration/stage1-foundation.test.ts` (7 tests) — Harness & DB isolation
  10. `tests/integration/moderation.test.ts` (6 tests) — Moderation actions
  11. `tests/integration/sanctions.test.ts` (6 tests) — MUTE & BAN sanctions
  12. `tests/integration/safety-isolation.test.ts` (5 tests) — Cross-boundary safety
  13. `tests/integration/modlog.test.ts` (2 tests) — Public transparency log
- **TypeScript:** 0 errors across root (`npx tsc --noEmit`) and tests (`npx tsc -p tests/tsconfig.json --noEmit`).
- **Production Build:** 0 errors across all 9 App Router routes (`npm run build`).

---

## 13. Database / Prisma Status
- **Models (12):** `User`, `Session`, `Community`, `Membership`, `CommunitySanction`, `Post`, `Comment`, `PostVote`, `CommentVote`, `Report`, `ModerationAction`, `RateLimitBucket`.
- **Applied Migrations (5):**
  1. `20260903000000_init_with_report_check` — Core schema & Report CHECK constraint
  2. `20260903213816_optimize_community_feed_index` — Keyset feed index
  3. `20260904000000_drop_moderation_action_report_unique` — Multiple actions per report
  4. `20260904052000_partial_unique_pending_reports` — Deduplication partial unique indexes
  5. `20260904150045_add_search_indexes` — GIN expression indexes for FTS

---

## 14. Git / Commit Checkpoints
- **Branch:** `master`
- **Remote:** `origin https://github.com/sohamgandhale76/utopia.git`
- **Key Commit Milestones:**
  - `9ce3184` — Remote master baseline (project rename & contributing guide)
  - `c84c8cb` — Stage 6 Phase 1 Profiles & Stages 3–5 core features
  - `01867af` — Password hashing migration to Argon2id
  - `52bc203` — SEC-01 login resource-exhaustion protection commit
  - *Current Checkpoint* — Complete project state checkpoint

---

## 15. Open PRs / External Changes
- **PR #2 (`hoplite/praisos-8e3007d4`):**
  - Title: *"test: cover riskiest untested production paths"*
  - Status: OPEN
  - Detail: Adds focused integration tests covering edge cases. Contains no production code modifications. Requires later review and reconciliation.
- **PR #1 (`hoplite/olous-74a1437a`):**
  - Title: *"Remove unused clsx and tailwind-merge dependencies"*
  - Status: DRAFT

---

## 16. Known Limitations / Future Hardening
1. **In-Process Limiting Scope:** In-process rate limiting is local to each Node.js process. When horizontally scaling across multiple instances, edge rate limiting (Cloudflare WAF / AWS WAF) or a distributed store will be required for cluster-wide synchronization.
2. **Reverse Proxy Configuration Assumption:** When running with `TRUST_PROXY=true`, the upstream reverse proxy MUST be configured to overwrite client-supplied `X-Forwarded-For` headers to prevent header spoofing.
3. **Public Registration Abuse Control:** `ALLOW_PUBLIC_REGISTRATION=false` must remain disabled until proof-of-work or CAPTCHA is implemented.
4. **Search Pagination:** Post search supports cursor pagination; community and user searches currently return the first 20 matches.

---

## 17. Known Uncommitted Work (Part of this Checkpoint)
- **Search (Stage 6 Phase 2):** Migration `20260904150045_add_search_indexes`, `src/features/search/`, `src/app/search/`, `tests/integration/search.test.ts`.
- **Feed (Stage 6 Phase 3 Skeleton):** `src/features/feed/types.ts`, `src/features/feed/validation.ts`.
- **Community Sorting & Directory:** Deterministic sorting modes (`newest`, `members`, `alphabetical`) in `src/features/communities/service.ts` and `validation.ts`.
- **Global Search Header Bar:** Integrated search form in `src/app/layout.tsx`.
- **README Update:** Updated setup instructions to use `npm ci`.
- **Project Context Documentation:** `project_context.md` (this authoritative document).

---

## 18. Recommended Next Steps
1. **Stage 6 Phase 3 (Home & Discovery Feed):**
   - Implement `src/features/feed/service.ts` supporting `"home"`, `"community"`, and `"all"` feeds.
   - Implement cursor-based pagination and ranking sorts (`newest`, `top`, `hot`).
   - Wire Home feed UI into `src/app/page.tsx`.
2. **Stage 6 Phase 4 (In-App Notifications):**
   - Design notification schema (comment replies, mentions).
   - Implement notification trigger hooks in content domain.
   - Build notification tray in navigation shell.
3. **Stage 6 Phase 5 (Release Gate & Polish):**
   - Complete pre-launch security checklist.
   - Implement unauthenticated registration abuse control (Proof-of-Work).
   - Final UX/accessibility review.
4. **Reconcile PR #2:** Review and merge test coverage improvements from external branch.

---

## 19. Instructions for Future AI Agents
- **Do Not Modify Unrelated Features:** Keep feature work contained to the assigned domain.
- **Never Disable Database Isolation Guards:** Always use `getTestPrisma()` in tests; assert `instapro_test` on port 5433.
- **Always Test Sequentially:** Run `npm test` or `vitest --no-file-parallelism`.
- **Derive Identity on Server:** Never trust client-provided IDs. Always call `requireUser()`.
- **Preserve Argon2id Parameters:** $m=65536$, $t=3$, $p=4$, $v=19$. Never weaken hashing parameters.
- **Maintain Plain-Text Content Rule:** Never introduce HTML rendering or unescaped Markdown parsing into post/comment rendering.
- **Consult This Document:** Always review `project_context.md` before initiating architectural changes.
