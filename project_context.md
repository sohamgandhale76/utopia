# Utopia Project Context & State Specification

**Authoritative Project-State Specification**  
**Last Updated:** September 6, 2026  
**Current Branch:** `master`  
**Current HEAD:** `614b364` (PR #2 merged)  

---

## A. Project Identity & Philosophy

- **Project Name:** Utopia
- **Purpose:** A pseudonymous, privacy-preserving community discussion platform built on Next.js 15, TypeScript, PostgreSQL, and Prisma.
- **Product Philosophy:** Digital town square prioritizing authentic pseudonymous discussion, user agency, anti-surveillance privacy, zero algorithmic manipulation/engagement traps, minimal data retention, and strict server-enforced safety and privacy boundaries.
- **Core Privacy & Security Principles:**
  1. **Strict Pseudonymity:** User identity is completely decoupled from real-world PII. No mandatory emails, phone numbers, or real names are collected or required.
  2. **Hidden Member Rosters:** Community member rosters are private invariants. Member lists are never queryable or exposed publicly to prevent user profiling and targeted harassment. Only aggregate member counts are public.
  3. **Server-Derived Identity:** Identity and roles are strictly determined server-side from cryptographically validated sessions; client-supplied IDs and roles are completely untrusted.
  4. **Zero XSS Sinks:** Plain text rendering for posts and comments via React JSX without `dangerouslySetInnerHTML`, `innerHTML`, or `eval()`.
  5. **Auditable Moderation Transparency:** Moderation actions are recorded in an append-only public ModLog; `REVOKE_SANCTION` entries explicitly mask target pseudonyms to preserve privacy.

---

## B. Current Architecture

- **Framework:** Next.js 15.3.9 (App Router)
- **UI Library:** React 19.0.0 (Server & Client Components)
- **Language:** TypeScript 5.7.3 (Strict Mode enabled)
- **Styling:** Tailwind CSS 3.4.17
- **Database:** PostgreSQL 16 (Development on port 5432; Isolated Test Database `instapro_test` on port 5433 via `@embedded-postgres/windows-x64`)
- **ORM:** Prisma 6.4.1
- **Architecture Style:** Modular Monolith under `src/features/`
- **Directory Layout:**
  - `src/app/` — App Router routes (login, register, communities `/c`, search `/search`, profiles `/u/[username]`)
  - `src/features/auth/` — Password hashing (Argon2id), legacy bcrypt migration, session management, in-process rate limiting (SEC-01)
  - `src/features/communities/` — Community domain, memberships, sole-owner transfer, roles, hidden rosters, deterministic directory sorting
  - `src/features/content/` — Posts, comments, threading, soft deletion, community membership validation
  - `src/features/votes/` — Post/comment voting, atomic score recalculation via serializable transactions
  - `src/features/reports/` — Content reporting with PostgreSQL partial unique index deduplication
  - `src/features/moderation/` — Content removals, action logging, report resolution
  - `src/features/sanctions/` — Community MUTE and BAN enforcement
  - `src/features/profiles/` — Pseudonymous public profiles (`/u/[username]`), activity history, privacy filters
  - `src/features/search/` — PostgreSQL FTS (GIN expression indexes), ILIKE prefix search, escaped wildcards
  - `src/features/feed/` — Feed domain types and query validation schemas (**Note: Feed implementation is pending**)
  - `src/lib/db.ts` — PrismaClient singleton
  - `src/lib/transaction.ts` — Shared `executeWithRetry` helper for serializable PostgreSQL transactions with backoff handling Prisma `P2034` and raw write conflicts

---

## C. Security & Privacy Model

1. **Pseudonymous Identity:** Non-PII usernames, zero email or phone number collection.
2. **Authentication & Session Tokens:**
   - 256-bit cryptographically secure random session tokens (`crypto.randomBytes(32)`).
   - Stored and queried in PostgreSQL exclusively as SHA-256 hashes (`sessionTokenHash`).
   - Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` (in production).
   - Expired sessions are rejected and pruned from the database during validation.
3. **Password Security:** Canonical Argon2id ($m=65536\text{ KiB}$, $t=3$, $p=4$, $v=19$, 16-byte random salt). Password lengths bounded (12–64 UTF-8 bytes) to prevent algorithm memory exhaustion.
4. **Legacy Hash Migration:** Transparent verification of legacy bcrypt `$2a$` / `$2b$` hashes via `bcryptjs` and automatic re-hash into Argon2id on successful authentication.
5. **Login Resource-Exhaustion Protection (SEC-01):**
   - Concurrency Semaphore: max 4 active password verifications per Node.js process.
   - Bounded IP Burst Limiter: 5 requests / 10 seconds / IP with $O(1)$ LRU eviction (max 10,000 entries).
   - Per-`(IP, username)` Failure Throttle: 5 failed attempts / 15 minutes blocking attacker IP without locking out legitimate user on a different IP.
   - Proxy Safety: Forwarding headers (`X-Forwarded-For`, `X-Real-IP`) ignored by default unless `TRUST_PROXY=true` is explicitly set and upstream proxy strips client headers.
   - Fast-fail non-existent usernames: returns generic error immediately without Argon2 computation.
6. **Authorization & Membership Enforcement:** Server-side derivation via `requireUser()`. Content creation requires active membership in the target community.
7. **Hidden Member Rosters:** Invariant across all community queries. Only aggregate count is returned; member rosters are never public.
8. **Suspended Users:** Banned/suspended users are blocked from logging in, posting, commenting, voting, and their profile content is hidden.
9. **Moderation & Sanctions:** Community-level MUTE and BAN sanctions block post/comment creation. Removals soft-delete content (`isDeleted: true`), mark reports `ACTIONED`, and log to public append-only ModLog.
10. **Soft Deletion Semantics:** Content body replaced with `[deleted]`, author preserved as `[deleted]`, voting rejected on deleted content, soft-deleted comments excluded from post details, soft-deleted posts return null.
11. **Content Validation:** Bounded titles (1-300 chars) and bodies (1-40,000 chars), strictly plain text, zero HTML/markdown injection vectors.
12. **Transaction Resiliency:** Shared helper `executeWithRetry` handles PostgreSQL serializable conflicts (`P2034` / write conflict) with exponential backoff and jitter.

---

## D. Completed Work & Commit Milestones

- **Stage 1 (Foundation):** Base Next.js app, Prisma setup, PostgreSQL container, test harness with database isolation assertions (commit `7d644c3`).
- **Stage 2 (Pseudonymous Auth):** Signup, login, sessions, safe types, suspended-user checks (commits `4e55d91`, `f764281`, `bdaf894`).
- **Stage 2 Hardening (Argon2id & SEC-01):**
  - Argon2id password hashing migration (commit `01867af`).
  - SEC-01 login rate limiting & concurrency circuit breaker (commit `52bc203`).
- **Stage 3A & 3B (Communities):** Community creation, directory, `/c/[slug]`, join/leave, sole-owner transfer, roles, hidden rosters (commit `c84c8cb`).
- **Stage 4 (Content Foundation):** Plain-text posts, comments, threading, membership validation (commit `c84c8cb`).
- **Stage 5 (Moderation, Sanctions, Reports & ModLog):** Deduplicated reporting with partial unique index, post/comment removals, MUTE/BAN sanctions, public ModLog with target pseudonym masking (commit `c84c8cb`).
- **Stage 6A (Layout & Branding):** Responsive navigation shell, global search input, Utopia branding (commit `c84c8cb`).
- **Stage 6 Phase 1 (Profiles):** Public profile route `/u/[username]`, tabbed overview/posts/comments, privacy filtering (commit `c84c8cb`).
- **Stage 6 Phase 2 (Search):** PostgreSQL full-text search (GIN expression indexes `20260904150045_add_search_indexes`), prefix matching, escaped wildcards, search page (commit `22e347e`).
- **Community Directory Sorting:** Deterministic sorting modes (`members`, `alphabetical`, `newest`), normalization, fallback (commit `22e347e`).
- **Checkpoint Commit:** `22e347e chore: checkpoint current Utopia project state`.
- **PR #2 (Untested Production Paths Coverage):** Merged via `614b364` (added 16 tests covering sanction enforcement, expired session cleanup, report scoping, dedup race, `executeWithRetry`, community directory sort modes).

---

## E. Current Feed State

**CRITICAL: Feed is NOT implemented yet.**

- **Currently Present:**
  - `src/features/feed/types.ts` (`FeedType`, `FeedSort`, `FeedItem`, `FeedResponse` domain types)
  - `src/features/feed/validation.ts` (Zod validation schemas for feed queries)
- **Currently Missing:**
  - Feed service (`src/features/feed/service.ts`)
  - Feed queries and ranking algorithms (`"home"`, `"community"`, `"all"`; `"newest"`, `"top"`, `"hot"`)
  - Home / Discovery feed UI in `src/app/page.tsx`
  - Keyset / cursor-based pagination behavior
  - Feed integration tests
- **Do NOT describe Feed as completed.**

---

## F. Current Testing State

- **Test Runner:** Vitest 3.0.7 (Executed strictly with `vitest run --no-file-parallelism` or `npm test`)
- **Total Tests:** **203 / 203 passing tests across 14 test files (0 failures, 0 skipped)**
- **Test Files Breakdown:**
  1. `tests/integration/auth.test.ts` (44 tests) — Auth, sessions, bcrypt migration, expired session pruning
  2. `tests/integration/auth-rate-limit.test.ts` (23 tests) — SEC-01 rate limiting, concurrency breaker, anti-lockout
  3. `tests/integration/profiles.test.ts` (24 tests) — Public profiles & privacy filtering
  4. `tests/integration/community.test.ts` (23 tests) — Communities, memberships, sort modes, no-roster invariant
  5. `tests/integration/reports.test.ts` (14 tests) — Reporting, mod queue community scoping, concurrent dedup race
  6. `tests/integration/content.test.ts` (13 tests) — Posts, comments, MUTE/BAN blocking, deleted content handling
  7. `tests/integration/votes.test.ts` (9 tests) — Voting, concurrency, deleted comment voting rejection
  8. `tests/integration/sanctions.test.ts` (6 tests) — MUTE & BAN sanctions
  9. `tests/integration/moderation.test.ts` (7 tests) — Removals, report actioning
  10. `tests/integration/stage1-foundation.test.ts` (7 tests) — Database isolation & harness validation
  11. `tests/integration/modlog.test.ts` (3 tests) — Transparency log, sanction revocation pseudonym masking
  12. `tests/integration/search.test.ts` (19 tests) — FTS & prefix search
  13. `tests/integration/transaction.test.ts` (6 tests) — `executeWithRetry` unit tests (P2034, write conflict, backoff)
  14. `tests/integration/safety-isolation.test.ts` (5 tests) — Cross-boundary safety & isolation
- **TypeScript:** 0 errors across root (`npx tsc --noEmit`) and tests (`npx tsc -p tests/tsconfig.json --noEmit`).
- **Production Build:** 0 errors across all 12 App Router dynamic routes (`npm run build`).
- **PR #2 Status:** MERGED at commit `614b364fc5fe03533da9696d4a124e1448f7d69a`.

---

## G. Current Git / GitHub State

- **Branch:** `master`
- **HEAD:** `614b364fc5fe03533da9696d4a124e1448f7d69a`
- **Remote:** `origin https://github.com/sohamgandhale76/utopia.git`
- **Working Tree:** Clean (all commits pushed to `origin/master`).
- **Recent Commits:**
  - `614b364` Merge pull request #2 from sohamgandhale76/hoplite/praisos-8e3007d4
  - `53e32a6` test: cover riskiest untested paths in updated codebase
  - `01b591c` test: cover riskiest untested production paths
  - `22e347e` chore: checkpoint current Utopia project state
  - `52bc203` security: add login resource-exhaustion protection
  - `01867af` security: migrate passwords to Argon2id
- **Open PRs:**
  - PR #1 (`hoplite/olous-74a1437a`): *"Remove unused clsx and tailwind-merge dependencies"* (DRAFT)
  - PR #2: **MERGED**

---

## H. Remaining Roadmap & Reprioritization

**IMPORTANT CHANGE IN PRIORITY:**
The next major product phase is now **UI/UX & Design-System work BEFORE implementing Feed**.

**Reason:**
We want the designer to establish the visual language, typography, color palette, information architecture, responsive behavior, core components, and interaction patterns before building additional feature UI. This avoids implementing Feed and later having to rewrite it around a completely different design system.

### Ordered Next Phases:

1. **UI/UX Design Pass & Visual System:**
   - Establish design tokens, typography, color palette, and micro-interactions.
   - Define reusable component hierarchy (cards, post items, buttons, modals, badges, inputs).
   - Optimize information architecture for desktop, tablet, and mobile views.
2. **Staging / Demo Deployment for Designer:**
   - Deploy a staging/demo instance so the designer can evaluate the UI live.
   - Note: Deployment target is NOT yet finalized (Vercel, Netlify, Railway, or VPS to be evaluated).
   - This is strictly a staging/demo deployment for design review, NOT a claim of production-readiness.
3. **Design-System Implementation:**
   - Implement unified component library in `src/components/ui/` based on designer specifications.
   - Refactor existing pages (`/login`, `/register`, `/c`, `/c/[slug]`, `/u/[username]`, `/search`) to adopt the new design system.
4. **Feed Implementation (using established design system):**
   - Implement `src/features/feed/service.ts`:
     - `"home"` (joined communities feed), `"community"` (single community feed), `"all"` (public global feed).
     - Deterministic ranking sorts: `"newest"` (chronological), `"top"` (highest score), `"hot"` (decay-weighted engagement).
     - Keyset / cursor-based pagination.
   - Implement Home feed UI in `src/app/page.tsx` using the design system components.
   - Comprehensive integration tests in `tests/integration/feed.test.ts`.
5. **In-App Notifications (Stage 6 Phase 4):**
   - Database schema for notifications (comment replies, post upvotes, moderator actions).
   - Notification trigger hooks in content and moderation domains.
   - Notification tray and unread counter in navigation shell.
6. **Release Gate & Polish (Stage 6 Phase 5):**
   - Unauthenticated registration abuse control (Proof-of-Work or CAPTCHA).
   - End-to-end security review and penetration testing.
   - Accessibility (a11y) audit and performance optimization.

---

## I. Known Future Test Gaps (Non-Blocking)

1. **Replying to soft-deleted comments:** Verifying hierarchy preservation when replying to a comment that was soft-deleted.
2. **Comment vote revocation:** Verifying behavior when a user cancels or toggles a vote on a comment.
3. **Feed cursor boundary & timestamp collisions:** Edge cases with identical `createdAt` or score timestamps across page boundaries (to be covered during Feed service implementation).

---

## J. Non-Negotiable "DO NOT" Rules

1. **Do NOT weaken privacy for UI convenience:** Never expose email, IP, user location, or identity links.
2. **Do NOT expose member rosters:** Community membership rosters must remain strictly hidden. Never implement an endpoint or query returning all members of a community.
3. **Do NOT introduce PII:** Utopia is strictly pseudonymous. Never add fields for real names, phone numbers, or social links.
4. **Do NOT bypass server-side authorization:** UI visibility is not security. All authorization checks must be enforced in services and server actions.
5. **Do NOT trust client-supplied identity or roles:** Always derive user ID and roles server-side via `requireUser()`.
6. **Do NOT use `SELECT *`:** Always use explicit Prisma selectors or projections to avoid leaking sensitive fields (e.g., `passwordHash`, `sessionTokenHash`).
7. **Do NOT concatenate user input into raw SQL:** Always use Prisma `$queryRaw` parameterization and escape LIKE/ILIKE wildcards.
8. **Do NOT add fake/dummy security behavior:** All rate limiters, circuit breakers, and sanctions must be real, active, and tested.
9. **Do NOT implement Feed before design direction is established:** Adhere to the roadmap sequence unless explicitly instructed otherwise.
10. **Do NOT blindly merge PRs without reconciliation:** Always perform a read-only audit and test verification before merging external code.
11. **Do NOT rewrite architecture without justification:** Maintain the modular monolith structure under `src/features/`.
