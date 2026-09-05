# Utopia Agent Operating Manual

This document is the persistent operating manual for AI coding assistants working on Utopia.
When starting a session with no prior conversational context, read this document and `project_context.md` first.

---

## PROJECT CONTINUITY RULE

Before beginning any non-trivial task:
1. **Read `agent.md`** (this operating manual).
2. **Read `project_context.md`** (the authoritative project-state specification).
3. **Inspect `git status` and current branch** (`git status --short`, `git branch --show-current`).
4. **Check recent commits** (`git log --oneline -10`).
5. **Inspect relevant existing implementation** before changing anything.
6. **Use `project_context.md` as the current-state reference**, but verify critical facts against the repository.

*Never ask the user to re-explain the project state if the information can be recovered from these files.*

---

## CONTEXT MAINTENANCE RULE

**AFTER EVERY MAJOR TASK: Update `project_context.md` BEFORE declaring the task complete.**

A "major task" includes:
- Implementing a feature or feature phase
- Security hardening
- Architectural changes
- Database / Prisma schema changes and migrations
- Major refactoring
- Meaningful test-suite expansion
- Deployment configuration
- UI/UX system changes
- Merging or reconciling a PR
- Changing roadmap priorities
- Completing a security or code audit

The update must record:
- What changed
- Files and components affected
- Test count and verification results
- Security and privacy implications
- Current Git state (branch, HEAD, working tree cleanliness)
- What remains next
- Any newly discovered risks or limitations

---

## WHEN TO CHECK CONTEXT

Read `project_context.md` again whenever:
- Starting a new major task
- Resuming work after a session break
- Switching between feature areas
- After a major merge or rebase
- After completing a security audit
- When the project state appears inconsistent
- When unsure what has already been completed

*Do not blindly trust stale context.* If repository state and context disagree:
1. Inspect the repository.
2. Determine the actual state.
3. Update `project_context.md`.
4. Continue from the verified state.

---

## CHANGE DISCIPLINE

Before changing code:
- Understand existing architecture (modular monolith under `src/features/`).
- Inspect nearby implementations and follow existing patterns.
- Avoid unnecessary rewrites or adding unneeded dependencies.

After changing code:
- Run relevant tests (`npm test` or `npx vitest run --no-file-parallelism <file>`).
- Run TypeScript checks (`npx tsc --noEmit` and `npx tsc -p tests/tsconfig.json --noEmit`).
- Run the production build when appropriate (`npm run build`).
- Inspect `git diff` to ensure no unintended modifications or secrets exist.
- Update `project_context.md`.
- Do not make unrelated changes.

---

## SECURITY-FIRST RULES

Preserve Utopia's security and privacy model at all times.

**Never:**
- Introduce PII (no emails, phone numbers, real names, or identity cross-links).
- Expose hidden member rosters (rosters are private; only aggregate member count is public).
- Trust client identity or roles (client forms/headers must never specify authenticated `userId` or permissions).
- Bypass server-side authorization (UI element hiding is not security).
- Weaken server-side validation (all inputs must pass Zod schemas).
- Concatenate untrusted SQL (use parameterized queries and escape wildcards).
- Leak sensitive moderation information (mask target pseudonyms in sanction revocations).
- Silently change privacy semantics (deleted posts/comments must remain anonymized and soft-deleted).
- Treat client-side UI restrictions as security boundaries.

*When touching security-sensitive code (auth, sessions, rate limits, moderation, sanctions), perform an explicit adversarial review.*

---

## TESTING RULES

Tests must verify meaningful production behavior and security boundaries, not merely execute code.

- Prefer integration tests for authorization, membership, moderation, transactions, database state, and privacy boundaries.
- **Database Isolation Invariant:** All tests MUST use `getTestPrisma()` from `tests/helpers/test-db.ts` requiring `TEST_DATABASE_URL` targeting `instapro_test` on port 5433. Tests assert `current_database() === 'instapro_test'` and refuse to run or truncate any other database.
- **Sequential Execution:** Always run tests with `--no-file-parallelism` (e.g. `npm test`) because tests perform transactional database truncation.
- Never allow tests to silently fall back to the development `DATABASE_URL`.

---

## GIT RULES

Before committing:
- Inspect `git diff` and `git status`.
- Ensure no secrets, `.env` variables, build artifacts, or temporary scripts are staged.
- Run appropriate validation (`npm test`, `npx tsc --noEmit`).
- Update `project_context.md`.

After committing:
- Record the commit SHA in `project_context.md` when it represents a meaningful checkpoint.
- Verify working tree state (`git status --short` is clean).
- Do not merge PRs blindly without reconciliation and verification.

---

## CURRENT PRODUCT PRIORITY

**The current priority order is:**
1. **UI/UX Design Direction & Visual System**
2. **Staging / Demo Deployment for Designer** (target not yet finalized; evaluate Vercel/Netlify/etc.)
3. **Design-System Component Implementation** (`src/components/ui/`)
4. **Feed Implementation using established design system** (`src/features/feed/`, Home feed UI)
5. **In-App Notifications** (Stage 6 Phase 4)
6. **Release Gate & Production Polish** (Proof-of-Work registration abuse gate, security review, a11y)

**DO NOT start Feed implementation simply because Feed types/validation exist.**  
The deliberate decision is to establish the visual language, typography, layout, components, and interaction patterns with the designer FIRST, avoiding costly rewrites of Feed UI.

---

## SESSION RESUMPTION

A new session should be able to start with:
> *"Read `agent.md` and `project_context.md`, inspect git status, verify the current state, and continue from the documented NEXT STEP."*

The agent should immediately understand:
- What Utopia is (pseudonymous, privacy-preserving community discussion platform)
- What has been completed (Stage 1-5, Stage 6A, Profiles, Search, Argon2id, SEC-01 rate limiting, PR #2 integration test suite)
- What is currently in progress (UI/UX design direction & staging deployment preparation)
- What was deliberately postponed (Feed implementation, pending design-system establishment)
- What the next task is (UI/UX design pass & staging deployment evaluation)
- What security constraints must never be violated (hidden member rosters, server-derived identity, zero PII, plain-text content)
