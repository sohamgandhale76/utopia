# Stage 5 Architecture & Implementation Plan: Voting, Reporting, Sanctions, Moderation Actions & Community Moderation Transparency

> **Document Status**: Implementation-Ready Specification (Planning Phase Only).  
> **Scope**: Voting, Reporting, Community Sanctions, Moderation Actions, and Community-Scoped Moderation Transparency.  
> **Explicit Non-Goals**: Search, notifications, direct messages/chat, media/video uploads, recommendations/feeds algorithms, federation/decentralization, database migrations (unless proven mandatory), and rate-limiting implementation (deferred to a dedicated stage).

---

## 1. Current-State Repository Audit

An inspection of the repository codebase reveals the following baseline:
- **Prisma Schema (`prisma/schema.prisma`)**: Contains 12 models and 3 applied migrations:
  1. `20260903000000_init_with_report_check`: Created initial schema with `User`, `Session`, `Community`, `Membership`, `CommunitySanction`, `Post`, `Comment`, `PostVote`, `CommentVote`, `Report`, `ModerationAction`, `RateLimitBucket`, and the `check_report_target_exactly_one` CHECK constraint on `Report`.
  2. `20260903213816_optimize_community_feed_index`: Added `Post_communityId_isDeleted_createdAt_id_idx` on `Post(communityId, isDeleted, createdAt DESC, id DESC)`.
  3. `20260904000000_drop_moderation_action_report_unique`: Replaced `ModerationAction_reportId_key` with `ModerationAction_reportId_idx` so multiple mod actions can reference a single report.
- **Application Services (`src/features/`)**:
  - `auth`: Pseudonymous authentication, bcrypt-12 hashing, SHA-256 session management, and `requireUser()`.
  - `communities`: Community CRUD, `Membership` management with `CommunityRole` hierarchy (`MEMBER: 0`, `MODERATOR: 1`, `OWNER: 2`), `requireMembership()`, and `requireCommunityRole()`.
  - `content`: Plain-text posts and threaded comments (max depth 5), deterministic keyset feed pagination (`getCommunityFeed`), and public read projections selecting only `id` and `username`.
  - **No application logic exists yet** for voting, reporting, sanctions, or moderation actions.
- **Test Infrastructure**:
  - All tests execute against the isolated test database `instapro_test` on port 5433 using `TEST_DATABASE_URL` with strict `current_database() === 'instapro_test'` assertion guards. Tests run sequentially (`--no-file-parallelism`). 76/76 tests currently pass.

---

## 2. Existing Schema & Models Audit

| Model | Existing Fields & Constraints | Current Application Usage | Evaluation & Strategy |
|---|---|---|---|
| `PostVote` | `id`, `userId`, `postId`, `type` (`VoteType`: `UP`, `DOWN`), `createdAt`. Unique constraint: `@@unique([userId, postId])`. Index: `@@index([postId, type])`. | None in `src/`. Verified in Stage 1 foundation tests. | **Target: Reuse existing schema.** Unique constraint guarantees at most one vote per user per post. Composite index enables indexed count aggregation. |
| `CommentVote` | `id`, `userId`, `commentId`, `type` (`VoteType`: `UP`, `DOWN`), `createdAt`. Unique constraint: `@@unique([userId, commentId])`. Index: `@@index([commentId, type])`. | None in `src/`. Verified in Stage 1 foundation tests. | **Target: Reuse existing schema.** Fully sufficient for comment score computation and vote toggling. |
| `Report` | `id`, `reporterId`, `postId?`, `commentId?`, `reason` (VarChar(500)), `status` (`ReportStatus`: `PENDING`, `REVIEWED`, `DISMISSED`, `ACTIONED`), `createdAt`, `updatedAt`. DB CHECK: `check_report_target_exactly_one`. Indexes: `[status, createdAt]`, `[postId]`, `[commentId]`. | None in `src/`. Verified in Stage 1 foundation tests. | **Target: Reuse existing schema.** Single-target constraint enforced by PostgreSQL. Pending deduplication enforced by service layer. |
| `CommunitySanction` | `id`, `communityId`, `userId`, `sanctionType` (`MUTE`, `BAN`), `reason` (VarChar(500)), `issuedById`, `issuedAt`, `expiresAt?`, `revokedAt?`. Indexes: `[communityId, userId, revokedAt, expiresAt]`, `[userId]`. | None in `src/`. Verified in Stage 1 foundation tests. | **Target: Reuse existing schema.** Composite index perfectly matches active sanction predicate (`revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > NOW())`). |
| `ModerationAction` | `id`, `communityId`, `moderatorId`, `targetUserId?`, `reportId?`, `postId?`, `commentId?`, `sanctionId?`, `actionType` (`ModActionType`), `reason` (VarChar(500)), `internalNote?` (VarChar(500)), `createdAt`. Indexes: `[communityId, createdAt DESC]`, `[createdAt DESC]`, `[postId]`, `[commentId]`, `[sanctionId]`, `[reportId]`. | None in `src/`. Migration 3 removed uniqueness on `reportId`. | **Target: Reuse existing schema.** Append-only audit record linking acting moderator, target entity, and public explanation. |
| `RateLimitBucket` | Exists in database and schema. | None in `src/`. | **Strictly Out of Scope**: Preserved untouched. Rate limiting implementation is deferred to a future stage. |

> **Migration Policy**:  
> Target: reuse the existing schema and require zero migrations if possible. If implementation reveals a genuinely necessary schema change, stop and document/justify it before creating a migration.

---

## 3. Core Architectural Specifications

### A. Separation of Reporter Reason vs. Moderator Public Reason
To guarantee reporter privacy and eliminate data leaks, two fundamentally distinct reason concepts are established:
1. **`Report.reason` (Private Reporter Input)**:
   - Authored by the user reporting content.
   - Strictly private.
   - Visible **only** to authorized community moderators/owners inside the private moderation review queue.
   - **Never** exposed publicly or in any public API/component.
   - **Never** automatically copied into `ModerationAction.reason` or public audit logs.
2. **`ModerationAction.reason` (Moderator-Authored Public Rationale)**:
   - Authored directly by the acting moderator when executing a moderation action (`REMOVE_POST`, `REMOVE_COMMENT`, `ISSUE_SANCTION`, `REVOKE_SANCTION`, `DISMISS_REPORT`).
   - Represents a standardized, sanitized public explanation (e.g., "Violates Rule 1: No spam or unsolicited commercial promotion").
   - Exposed in the community public moderation log (`/c/[slug]/modlog`).
   - Must not contain reporter-identifying details or raw reporter input unless independently and safely synthesized by the moderator.
3. **`ModerationAction.internalNote` (Confidential Mod-to-Mod Note)**:
   - Optional internal communication between community moderators.
   - Excluded from all public queries, selectors, and views.

### B. Sanction Authorization Hierarchy & Revocation Rules
Authority to moderate and sanction is strictly scoped to the community boundary. Platform `User.role` alone does not confer community moderation privileges.

- **Community OWNER**:
  - Can sanction (`MUTE` or `BAN`) ordinary community members and community moderators.
  - Can revoke any active sanction within their community.
  - **Cannot be sanctioned** through community moderation.
- **Community MODERATOR**:
  - Can sanction (`MUTE` or `BAN`) ordinary community members only.
  - **Cannot sanction another MODERATOR** (peer-moderator protection).
  - **Cannot sanction the community OWNER**.
  - Can revoke sanctions on ordinary community members.
  - **Cannot revoke sanctions issued against a moderator or owner**, nor sanctions issued directly by the `OWNER`.
- **Ordinary Members**:
  - Cannot issue or revoke sanctions under any circumstances.
- **Self-Action Prevention**:
  - **No user can sanction themselves** (`targetUserId !== actorId`).
  - **No user can revoke their own sanction** (`targetUserId !== actorId`).
- **Role Changes & Least Privilege**:
  - When a moderator is demoted to ordinary member (`MODERATOR` → `MEMBER`), they lose access to the private moderation queue and moderation actions immediately.
  - When a member is promoted to moderator (`MEMBER` → `MODERATOR`), they gain moderation capabilities immediately.
  - Historical `ModerationAction` records previously authored by that user remain immutable and valid under the actor's historical pseudonym. Current permissions determine current access; past roles grant no ongoing private access.

### C. Community Ban vs. Membership Lifecycle
A community `BAN` is a punitive sanction, **not** an account or membership deletion:
1. **Preservation of Membership**:
   - Issuing a `BAN` does **not** delete the user's `Membership` record. The record is retained to preserve join history, role history, and audit linkages.
2. **Sanction Restrictions**:
   - An active `BAN` prevents the user from posting, commenting, casting votes, submitting reports, and joining/participating in the community.
3. **Prevention of Leave/Rejoin Bypass**:
   - A banned user cannot bypass their ban by leaving and rejoining.
   - `joinCommunity` in `src/features/communities/service.ts` will explicitly evaluate `checkUserSanction(communityId, userId, "JOIN")`. If an active ban exists, the join request is **rejected with an error**.
   - If a banned user calls `leaveCommunity`, the active `CommunitySanction` record remains intact in PostgreSQL. Subsequent attempts to rejoin remain blocked until the sanction expires or is revoked.
4. **Unban / Revocation**:
   - Revoking a ban (`revokedAt = now()`) immediately lifts participation restrictions.
   - The user's historical `Membership` record remains intact with its original join date.

### D. Intentional MUTE & BAN Product Decisions
The scope of each sanction is an explicit, intentional product governance decision:
- **`MUTE`**:
  - **Disabled**: Creating posts (`createPost`), creating comments (`createComment`), casting votes (`castPostVote`, `castCommentVote`).
  - **Allowed**: Reading public feeds, reading public posts/comments, submitting reports.
  - *Product Rationale*: Muting restricts content creation and prevents vote manipulation or brigading by bad actors while preserving basic reading access.
- **`BAN`**:
  - **Disabled**: Creating posts, creating comments, casting votes, submitting reports, joining the community.
  - **Allowed**: Reading public content (per Locked Decision #5: all communities are public to read in V1).
  - *Product Rationale*: Completely excludes the user from community participation.
- **Immediate Effect & Dynamic Expiry**:
  - Sanctions apply immediately upon transaction commit.
  - Expiry is dynamically evaluated: `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > NOW())`. Expired sanctions cease restricting actions automatically without requiring cron jobs.
  - Revocations immediately restore permissions.

### E. Append-Only Moderation Actions at the Application Boundary
The application service layer strictly enforces immutability for moderation actions:
- **Allowed Operations**:
  - `createModerationAction` (append new record within a transaction).
  - `getCommunityModLog` (query historical records).
- **Prohibited Operations**:
  - Application services expose **zero** functions to update, edit, or delete `ModerationAction` records.
- **Correction Semantics**:
  - If a moderation action was performed in error (e.g., an incorrect ban or erroneous post removal), the historical action is **never** edited or deleted.
  - A compensating corrective action is appended to the audit log (e.g., `REVOKE_SANCTION` with reason "Sanction issued in error; restored", or restoring post `isDeleted: false` with compensatory audit log).
  - *Database Note*: True database-level immutability (PostgreSQL triggers rejecting `UPDATE`/`DELETE` on `ModerationAction`) can be evaluated in a future migration pass; at the application layer, immutability is guaranteed by omitting mutating APIs.

### F. Voting Invariants & Concurrency
- **Core Invariants**:
  - `(userId, postId)` identifies at most one `PostVote`.
  - `(userId, commentId)` identifies at most one `CommentVote`.
- **State Transition & Score Delta Matrix**:
  | Starting State | Requested Action | Final State | Score Delta |
  |---|---|---|---|
  | None | UP | UP | +1 |
  | None | DOWN | DOWN | -1 |
  | UP | UP (toggle) | None (deleted) | -1 |
  | DOWN | DOWN (toggle) | None (deleted) | +1 |
  | UP | DOWN | DOWN | -2 |
  | DOWN | UP | UP | +2 |
- **Score Semantics**:
  - `Score = Upvotes - Downvotes`.
  - Unbounded and allowed to be negative (Locked Decision #3).
  - Dynamic indexed counting via `[postId, type]` and `[commentId, type]` avoids cache desynchronization.
- **Concurrency Strategy**:
  - All vote modifications run in `prismaClient.$transaction` with `Serializable` isolation wrapped in the established `executeWithRetry` bounded P2034 retry helper.
  - Unique database constraints prevent double-voting under concurrent requests.

### G. Community-Scoped Moderation Transparency (`/c/[slug]/modlog`)
- **Community-Scoped Surface**:
  - Stage 5 public transparency is strictly scoped to `/c/[slug]/modlog`.
  - Platform-wide `/modlog` is **deferred** until platform-level governance and platform admin actions are formally introduced in a later stage.
- **PUBLIC vs. PRIVATE Moderation Data Matrix**:
  | Moderation Event | Publicly Visible Data in `/c/[slug]/modlog` | Strictly Private Data (Never Exposed) | Target Pseudonym Policy |
  |---|---|---|---|
  | **`REMOVE_POST`** | Mod username, action (`REMOVE_POST`), public reason, timestamp, post ID/title. | Reporter ID, reporter reason, internal note. | **PRIVATE (Omitted)**: Target author pseudonym is omitted to prevent public dogpiling. |
  | **`REMOVE_COMMENT`** | Mod username, action (`REMOVE_COMMENT`), public reason, timestamp, comment ID. | Reporter ID, reporter reason, internal note. | **PRIVATE (Omitted)**: Target author pseudonym is omitted. |
  | **`ISSUE_SANCTION`** | Mod username, action (`ISSUE_SANCTION`), sanction type (`MUTE`/`BAN`), duration/expiry, public reason, timestamp. | Target credentials, session info, internal note, reporter info. | **PRIVATE (Masked)**: Target pseudonym is masked as "Sanctioned a member" to avoid public shaming. |
  | **`REVOKE_SANCTION`** | Mod username, action (`REVOKE_SANCTION`), public reason, timestamp. | Internal note, target credentials. | **PRIVATE (Masked)**: Target pseudonym is masked. |
  | **`DISMISS_REPORT`** | Mod username, action (`DISMISS_REPORT`), public reason, timestamp. | Reporter ID, reporter reason, target author identity, internal note. | **PRIVATE (Omitted)**: No target or reporter identity exposed. |

---

## 4. Comprehensive 6-Tier Authorization Matrix

| Action | Anonymous Visitor | Authenticated Non-Member | Authenticated Member | Community Moderator | Community Owner | Platform Admin (`User.role`) |
|---|---|---|---|---|---|---|
| **View Public Feeds & Posts** | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed |
| **View Community Mod Log (`/c/[slug]/modlog`)** | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed |
| **Cast Vote (Post or Comment)** | Denied (401) | Denied (403: Must Join) | Allowed (if not Muted/Banned) | Allowed | Allowed | Member rules apply |
| **Submit Report** | Denied (401) | Denied (403: Must Join) | Allowed (if not Banned) | Allowed | Allowed | Member rules apply |
| **View Own Submitted Reports** | Denied | Denied | Denied (No user report dashboard in V1) | Denied | Denied | Denied |
| **View Community Report Queue** | Denied (401) | Denied (403) | Denied (403) | Allowed (own community) | Allowed (own community) | Denied (Community scoped) |
| **Remove Post / Comment** | Denied (401) | Denied (403) | Denied (403) | Allowed (own community) | Allowed (own community) | Denied (Community scoped) |
| **Dismiss Report** | Denied (401) | Denied (403) | Denied (403) | Allowed (own community) | Allowed (own community) | Denied (Community scoped) |
| **Sanction Ordinary Member** | Denied (401) | Denied (403) | Denied (403) | Allowed | Allowed | Denied (Community scoped) |
| **Sanction Moderator** | Denied (401) | Denied (403) | Denied (403) | **Denied** (Peer protection) | **Allowed** | Denied (Unless Owner) |
| **Sanction Owner** | Denied (401) | Denied (403) | Denied (403) | **Denied** (Owner immune) | **Denied** (Owner immune) | Denied |
| **Revoke Member Sanction** | Denied (401) | Denied (403) | Denied (403) | Allowed | Allowed | Denied (Community scoped) |
| **Revoke Moderator Sanction** | Denied (401) | Denied (403) | Denied (403) | **Denied** | **Allowed** | Denied (Unless Owner) |
| **Platform-Level Moderation** | Denied | Denied | Denied | Denied | Denied | Deferred to future stage |

---

## 5. Dependency-Aware Implementation Sequence

```text
1. Authorization & Sanction Evaluation Foundations (src/features/sanctions/guards.ts)
   └── Implements checkUserSanction(); establishes active mute/ban evaluation required by all actions.

2. Validation Primitives (src/features/*/validation.ts)
   └── Zod schemas for votes, reports, sanctions, and moderation actions.

3. Voting Feature (src/features/votes/)
   └── Services (castPostVote, castCommentVote), score calculation, Server Actions, vote UI.

4. Reporting Feature (src/features/reports/)
   └── Services (submitReport, listModReports), deduplication logic, modal UI.

5. ModerationAction Audit Infrastructure (src/features/moderation/audit.ts)
   └── Append-only audit logging helper creating immutable ModerationAction records.

6. Content Moderation & Removal Workflows (src/features/moderation/content.ts)
   └── Soft-deletion of posts/comments with required ModAction audit creation.

7. Sanction Management (src/features/sanctions/)
   └── Issue/revoke mutes and bans with role hierarchy enforcement and audit logging.
   └── Wire sanction guards into createPost, createComment, and joinCommunity.

8. Community-Scoped Public Moderation Transparency (/c/[slug]/modlog)
   └── Public community moderation feed with strict projection masks.

9. Integration Test Suite (tests/integration/)
   └── Verification across all 5 feature areas on isolated test database.

10. UI Integration (src/app/)
    └── Community moderation queue view, transparency log page, feed/detail vote and report controls.
```

---

## 6. Comprehensive Integration Test Plan

All tests execute against the isolated test database `instapro_test` on port 5433 using `TEST_DATABASE_URL` with strict `current_database()` assertion guards.

### A. Voting Integration Tests (`tests/integration/votes.test.ts`)
- **Duplicate-Vote Invariant**: Asserts exactly one vote record per `(userId, postId)` and `(userId, commentId)`.
- **State Transitions**:
  - None → UP: Score increases by 1.
  - None → DOWN: Score decreases by 1.
  - UP → UP (toggle): Vote deleted, score decreases by 1.
  - DOWN → DOWN (toggle): Vote deleted, score increases by 1.
  - UP → DOWN: Vote type toggled, score decreases by 2.
  - DOWN → UP: Vote type toggled, score increases by 2.
- **Authorization Boundaries**:
  - Non-members cannot vote.
  - Unauthenticated requests are rejected.
  - Muted users cannot vote.
  - Banned users cannot vote.
  - Soft-deleted posts and comments reject votes.
- **Concurrency**:
  - Concurrent vote toggles from the same user resolve to a deterministic final state without unique constraint errors.
  - Concurrent votes from multiple distinct users calculate exact aggregate scores without lost updates.

### B. Reporting Integration Tests (`tests/integration/reports.test.ts`)
- **Single-Target Enforcement**:
  - Reporting post only succeeds.
  - Reporting comment only succeeds.
  - Database constraint rejects dual-target or zero-target reports.
- **Deduplication**:
  - Submitting a second report for the same content while a previous report is `PENDING` is rejected.
- **Privacy Assurance**:
  - Public selectors and queries never expose `reporterId` or `reporter.username`.
  - Non-moderators are rejected from viewing community report queues.
- **Sanction Check**: Banned users cannot submit reports.

### C. Sanctions Integration Tests (`tests/integration/sanctions.test.ts`)
- **Hierarchy Enforcement**:
  - Moderator can sanction ordinary member.
  - Moderator **cannot sanction another moderator** (rejected with 403).
  - Moderator **cannot sanction owner** (rejected with 403).
  - Owner cannot be sanctioned through community moderation.
  - Self-sanctioning is rejected.
  - Self-revocation is rejected.
- **Ban Participation & Bypass Prevention**:
  - Muted user cannot post, comment, or vote.
  - Banned user cannot post, comment, vote, report, or join community.
  - Banned user leaving the community cannot bypass the ban (`joinCommunity` rejects active ban).
- **Expiry & Revocation**:
  - Expired sanction automatically permits action without manual revocation.
  - Revocation by authorized moderator immediately restores permissions and logs `REVOKE_SANCTION`.
  - Moderator cannot revoke an Owner-issued sanction.
- **Role Changes & Least Privilege**:
  - Demoted moderator immediately loses moderation queue and sanction privileges.

### D. Moderation Actions & Audit Tests (`tests/integration/moderation.test.ts`)
- **Append-Only Invariant**:
  - Moderation action records cannot be updated or deleted via application services.
  - Corrective actions append new compensating records (`REVOKE_SANCTION`).
- **Content Removal**:
  - Removing a post marks `isDeleted: true`, sets `deletedByRole = 'MODERATOR'`, and writes `ModerationAction`.
  - Removing a comment preserves child replies in the tree with soft-delete metadata.
- **Report Lifecycle**:
  - Dismissing a report sets `status = DISMISSED` and logs `ModerationAction`.
  - Actioning a report sets `status = ACTIONED` and links `reportId` to `ModerationAction`.

### E. Community Transparency Tests (`tests/integration/modlog.test.ts`)
- **Public Feed Output**:
  - Returns action type, community slug, moderator username, public reason, timestamp.
- **Information Masking Verification**:
  - Explicitly asserts that `internalNote` is `undefined` / not returned.
  - Explicitly asserts that `reporterId` and `Report.reason` are `undefined` / not returned.
  - Asserts target author pseudonym is omitted on content removals to prevent public harassment.

---

## 7. Approved Key Architectural Decisions

The following 4 architectural decisions have been formally approved:

1. **Target Pseudonym Visibility in Sanctions Transparency**:
   - **Decision: OPTION B — Mask the target pseudonym** (e.g., `Sanctioned a member: 24h Mute`) to prevent public dogpiling, retaliatory harassment, and user targeting on a pseudonymous platform.
   - *Status*: **Approved**.
2. **Reporter Notification & Tracking**:
   - **Decision: OPTION B — No notifications or tracking dashboard in V1**. Reports function strictly as one-way queue inputs for authorized community moderators.
   - *Status*: **Approved**.
3. **Reporting Already-Soft-Deleted Content**:
   - **Decision: OPTION B — Reject reports on already-soft-deleted content (`isDeleted = true`)**. Soft-deleted content is already removed from public visibility and feeds.
   - *Status*: **Approved**.
4. **Moderation of Content Authored by Moderators**:
   - **Decision: OPTION B — A peer Moderator may remove inappropriate content posted by another Moderator, but only the community OWNER may impose punitive sanctions on a Moderator**. Sanctioning a community moderator requires owner authority.
   - *Status*: **Approved**.

---

## 8. Stage 5 Definition of Done

1. **Feature Completeness**:
   - Voting functional for posts and comments (UP, DOWN, unvote toggle, unbounded score calculation).
   - Reporting functional (post/comment targets, deduplication, private moderator queue).
   - Sanctions functional (`MUTE` and `BAN`, dynamic expiry, revocation, hierarchy enforcement, join-bypass protection).
   - Moderation actions append-only audit logging functional.
   - Community-scoped public moderation transparency (`/c/[slug]/modlog`) functional.
2. **Security & Privacy Boundaries**:
   - All server actions derive identity strictly from `requireUser()`; client-supplied user IDs rejected.
   - No exposure of `passwordHash`, session tokens, session hashes, or global `User.role`.
   - `Report.reason` and `reporterId` strictly hidden from public views.
   - `ModerationAction.internalNote` strictly hidden from public views.
3. **Database & Migrations**:
   - Existing authoritative schema reused. Zero new migrations created unless a change is proven necessary, documented, and approved.
   - CHECK constraints, composite indexes, and foreign keys remain intact.
4. **Testing & Quality Assurance**:
   - All planned Stage 5 integration tests pass sequentially against `instapro_test` on port 5433.
   - All existing tests continue to pass with zero regressions.
   - `npm test` and `npm run build` succeed with exit code 0.
5. **Documentation**:
   - `docs/PROJECT_CONTEXT.md` updated with truthful test and build results upon completion.
