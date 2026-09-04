# Stage 6 Architecture & Implementation Plan: Search, Profiles, Discovery / Feed, Notifications & UX Improvements

> **Document Status**: Authoritative Planning Specification (Audit & Planning Only — Zero Application Code Modified).  
> **Target Release**: Stage 6 (Search, Profiles, Discovery/Feed, Notifications, and Core UX Refinements).  
> **Platform Name**: Utopia (formerly Insta-pro).  
> **Non-Negotiable Constraints**: Plain text only; pseudonymous zero-PII architecture; append-only moderation auditability; strict database-level test isolation on port 5433 (`instapro_test`); zero modification to existing migrations.

---

## 1. Executive Summary

Utopia has successfully achieved its Stage 5 milestone: pseudonymous authentication, community creation and role hierarchies, plain-text content and threaded comments (max depth 5), deterministic keyset-paginated feeds, dual-target voting with dynamic unbounded scoring, single-target reporting with PostgreSQL CHECK and partial unique constraint invariants, community-scoped sanctions (`MUTE` and `BAN`) with leave/rejoin bypass prevention, append-only moderation audit logging, and public community moderation transparency logs (`/c/[slug]/modlog`). 110/110 integration tests pass against an isolated PostgreSQL test database, and the production Next.js build passes with 0 errors.

Stage 6 bridges the gap between a robust data-governance engine and an engaging, usable community platform. This specification defines five core functional areas:
1. **Search**: Deterministic, privacy-safe search across communities, posts, and user handles using PostgreSQL full-text and pattern capabilities without external search dependencies.
2. **Profiles**: Pseudonymous user profile views (`/u/[username]`) exposing public post and comment history while strictly preserving voter confidentiality, hiding confidential report histories, and protecting community member rosters against scraping and user profiling.
3. **Discovery & Feeds**: A multi-community chronological Home Feed (`/`) for authenticated users based on joined communities, a global discovery feed for visitors, and community discovery filters.
4. **Notifications**: An in-app, pull-based notification engine for content replies, content removals, and sanction events with strict recipient authorization, self-action exclusion, and deduplication.
5. **UX Improvements**: Brand unification under Utopia, a persistent global navigation header, loading/error boundary states, and responsive navigation controls.

---

## 2. Verified Stage 5 Baseline

An independent code-and-database audit of the repository establishes the following ground truth:

### Database & Migrations
The database schema consists of 12 Prisma models and 4 applied PostgreSQL migrations:
1. `20260903000000_init_with_report_check`: Initial schema + `check_report_target_exactly_one` CHECK constraint on `Report`.
2. `20260903213816_optimize_community_feed_index`: Added composite index `Post_communityId_isDeleted_createdAt_id_idx` on `Post(communityId, isDeleted, createdAt DESC, id DESC)`.
3. `20260904000000_drop_moderation_action_report_unique`: Replaced unique index on `ModerationAction(reportId)` with a non-unique index to permit multiple mod actions referencing one report.
4. `20260904052000_partial_unique_pending_reports`: Added PostgreSQL partial unique indexes `Report_reporterId_postId_pending_unique` and `Report_reporterId_commentId_pending_unique` where `status = 'PENDING'`.

### Verified Service Implementations
- **Authentication (`src/features/auth/`)**: Bcrypt (cost 12), 256-bit cryptographically random tokens stored strictly as SHA-256 hashes (`sessionTokenHash`), HttpOnly/SameSite=Lax cookies, suspended session revocation, closed public registration gate (`ALLOW_PUBLIC_REGISTRATION=false`).
- **Communities (`src/features/communities/`)**: Public directory (`/c`), public detail (`/c/[slug]`), create community (`/c/create`), membership role hierarchy (`MEMBER: 0`, `MODERATOR: 1`, `OWNER: 2`), sole-owner departure guard, hidden membership rosters (member counts are public; username rosters are hidden from non-moderators).
- **Content (`src/features/content/`)**: Plain-text posts, threaded comments (max depth 5), deterministic keyset feed pagination (`createdAt DESC, id DESC` with base64url cursor), soft-deletion (`isDeleted: true`), public author selection strictly limited to `{ id, username }`.
- **Voting (`src/features/votes/`)**: Dual-table architecture (`PostVote`, `CommentVote`), unvote toggle, dynamic unbounded scoring (`upvotes - downvotes`), Serializable transactions with bounded retry.
- **Reporting (`src/features/reports/`)**: Single-target reporting validated by PostgreSQL CHECK constraint and deduplicated via partial unique indexes + Serializable transactions. Private moderator queue (`listCommunityReports`). Reporter ID and reason are strictly excluded from public views.
- **Sanctions (`src/features/sanctions/`)**: Scoped to community boundary (`MUTE` blocks post/comment/vote; `BAN` blocks post/comment/vote/report/join). Dynamic expiry evaluation, hierarchy protection (owner immune; mod cannot sanction mod/owner; no self-sanction/revocation), join-bypass prevention (banned user cannot rejoin after leaving).
- **Moderation Actions & Transparency (`src/features/moderation/`)**: Append-only `ModerationAction` audit logging (zero update/delete application paths). Compensating actions for corrections. Community transparency log (`/c/[slug]/modlog`) with target pseudonym masking for sanctions ("Sanctioned a member") and omission for removals.

### Technical Debt, Gaps & Architectural Discrepancies
1. **Placeholder Landing Page**: `src/app/page.tsx` is still a Phase 0 / Stage 1 starter card referencing "Insta-pro" and "Stage 1: Core Foundation Active".
2. **Missing Global Layout & Navigation**: `src/app/layout.tsx` contains no navigation header, search bar, profile link, or notification badge. Navigation currently relies on ad-hoc breadcrumbs on individual subpages.
3. **Repeated Transaction Retry Helper**: Every service (`votes/service.ts`, `reports/service.ts`, `sanctions/service.ts`, `moderation/service.ts`, `content/service.ts`, `communities/service.ts`) maintains an independent local copy of `executeWithRetry`. This should be extracted into a shared `src/lib/transaction.ts` module.
4. **Unimplemented Rate Limiting**: Model `RateLimitBucket` exists in schema and PostgreSQL migration 1, but zero application logic exists in `src/` to populate or evaluate it.
5. **No Public Profile Route**: Users have handles (`u/username`), but there is no `/u/[username]` page or service to view their activity.
6. **No Multi-Community Home Feed**: Feeds are strictly scoped to a single community (`/c/[slug]`). No unified feed exists for joined communities.
7. **No Notification Mechanism**: Users receive no feedback when their posts/comments receive replies, when content is removed, or when sanctions are applied.

---

## 3. Stage 6 Goals

1. **Search**: Implement clean, fast, deterministic search for communities, posts, and user handles using PostgreSQL full-text and pattern capabilities with explicit pagination and bounded query limits.
2. **Profiles**: Implement pseudonymous public profiles (`/u/[username]`) presenting account age, public post history, and public comment history while preserving strict voter privacy, hiding confidential report histories, and protecting community membership rosters.
3. **Discovery & Feeds**: Build an authenticated multi-community Home Feed (`/`) combining posts from all communities a user has joined, alongside a global discovery feed for visitors and enhanced community directory sorting.
4. **Notifications**: Create an in-app notification pipeline (`Notification` model) for content replies, content removals, and community sanctions with clear read/unread state management and recipient-only authorization.
5. **UX Improvements**: Establish a unified Utopia navigation bar in the root layout, add loading and error boundaries, polish mobile responsiveness, and clean up remaining legacy naming.

---

## 4. Architecture & Dependencies

```
                                 [Stage 5 Complete Baseline]
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    ▼                                                   ▼
       Phase 0: Shared Refactoring                         Phase 1: Pseudonymous Profiles
       - Extract executeWithRetry                          - /u/[username] route
       - RootLayout Header & Nav                           - Post & comment public history
       - Branding (Utopia metadata)                        - Zero schema changes
                    │                                                   │
                    └─────────────────────────┬─────────────────────────┘
                                              ▼
                                       Phase 2: Search
                                       - PostgreSQL full-text indexes (Post/Community)
                                       - /search route & tabbed results
                                       - Sanitized query validation
                                              │
                                              ▼
                               Phase 3: Discovery & Home Feed
                               - Multi-community feed query (joined communities)
                               - Authenticated / home feed
                               - Global chronological discovery feed
                                              │
                                              ▼
                                    Phase 4: Notifications
                                    - Notification model & migration
                                    - Content reply hooks (createComment)
                                    - Moderation hooks (removePost, removeComment, issueSanction)
                                    - /notifications route & unread header badge
                                              │
                                              ▼
                             Phase 5: UX Polish & Release Gate
                             - Loading & error boundary states
                             - Form validation & toast feedback
                             - Full test suite & release-gate verification
```

### Dependency Rules:
- **Phase 1 (Profiles)** requires **zero schema changes** and can be implemented immediately on top of existing models (`User`, `Post`, `Comment`).
- **Phase 2 (Search)** introduces search service queries and adds PostgreSQL full-text indexing via a dedicated migration.
- **Phase 3 (Discovery / Feed)** builds upon community memberships and content services.
- **Phase 4 (Notifications)** requires a new `Notification` model and migration, instrumenting existing write operations in `content` and `moderation` services.
- **Phase 5 (UX Polish)** integrates all components into the global UI.

---

## 5. Phase 1 — Search

### A. V1 Requirements vs. Future Search Capabilities
| Feature | V1 Search (Stage 6) | Future Search (Post-Stage 6) |
|---|---|---|
| **Community Search** | Exact slug match + full-text search on name and description | Fuzzy typo tolerance (`pg_trgm`) |
| **Post Search** | Full-text search on title and body within active communities | Stemming across multiple languages, synonym matching |
| **User Search** | Prefix match on lowercase username (`^[a-z0-9_]{3,24}$`) | Bio / activity matching |
| **Comment Search** | **Deferred** (high index bloat, low discovery value in V1) | Threaded comment search |
| **Ranking** | Deterministic: Exact match > Title match > Body match, secondary sort `createdAt DESC` | Algorithmic / ML recommendation ranking |
| **Infrastructure** | PostgreSQL native full-text (`tsvector`, `tsquery`) and GIN indexes | External search cluster (Elasticsearch / Meilisearch) |

### B. Query & Service Architecture
1. **Validation (`src/features/search/validation.ts`)**:
   - `searchQuerySchema`:
     - `q`: string, min 2 characters, max 100 characters, trimmed, stripped of null bytes and dangerous control characters.
     - `type`: enum `["ALL", "COMMUNITIES", "POSTS", "USERS"]`, default `"ALL"`.
     - `limit`: integer, min 1, max 50, default 20.
     - `cursor`: optional base64url cursor for keyset/offset pagination.
2. **Service Functions (`src/features/search/service.ts`)**:
   - `searchCommunities(query: string, limit: number): Promise<PublicCommunitySummary[]>`:
     - Searches `Community` where `name ILIKE %q%` OR `slug ILIKE %q%` OR `to_tsvector('english', name || ' ' || description) @@ websearch_to_tsquery('english', q)`.
     - Returns public community summaries with member counts.
   - `searchPosts(query: string, communitySlug?: string, limit: number, cursor?: string): Promise<{ posts: PublicPost[]; nextCursor?: string }>`:
     - Searches `Post` where `isDeleted = false` AND `to_tsvector('english', title || ' ' || body) @@ websearch_to_tsquery('english', q)`.
     - Optionally filters by `communityId` if `communitySlug` is specified.
     - Enforces deterministic ordering: `ts_rank` descending, then `createdAt DESC`, then `id DESC`.
     - Projections: strictly `publicPostSelect` (only safe author `{ id, username }`).
   - `searchUsers(query: string, limit: number): Promise<Array<{ username: string; createdAt: Date }>>`:
     - Searches `User` where `username LIKE q%` (prefix match) AND `isSuspended = false`.
     - Projections: strictly `username` and `createdAt`. Never returns `id`, `passwordHash`, `role`, or session tokens.
3. **Privacy & Visibility Rules**:
   - Soft-deleted posts (`isDeleted: true`) are unconditionally filtered out.
   - Posts from muted users remain visible if not soft-deleted.
   - Suspended users are omitted from user search.
   - Public registration gate: searching does not expose registration state.

---

## 6. Phase 2 — Profiles

### A. Route & Data Flow
- Route: `/u/[username]` (`src/app/u/[username]/page.tsx`).
- Input: `params.username` validated against `^[a-z0-9_]{3,24}$`.

### B. Pseudonymity & Data-Flow Boundary Matrix
| Profile Field / Activity | Visible to Public Visitor | Visible to Profile Owner | Visible to Moderator | Technical Rationale |
|---|---|---|---|---|
| **Username** | Yes (`u/username`) | Yes | Yes | Public pseudonym. |
| **Account Age (`createdAt`)** | Yes (e.g. "Member since Jan 2026") | Yes | Yes | Establishing account tenure and trust. |
| **Avatar** | Deterministic SVG identicon | Deterministic SVG identicon | Deterministic SVG identicon | Zero media uploads; plain text only principle. |
| **Bio** | Optional plain text (max 300 chars) if schema allows, or omitted in V1 | Yes | Yes | Plain text only, zero HTML. |
| **Post History** | Yes (`isDeleted: false` only) | Yes (includes own deleted with tag) | Yes (`isDeleted: false` only) | Publicly authored content is public. |
| **Comment History** | Yes (`isDeleted: false` only) | Yes (includes own deleted with tag) | Yes (`isDeleted: false` only) | Publicly authored comments are public. |
| **Voted Content (Up/Down)** | **STRICTLY HIDDEN (403/Forbidden)** | Yes (optional private tab: "My Upvotes") | **STRICTLY HIDDEN** | Voter privacy invariant: voting is anonymous. |
| **Submitted Reports** | **STRICTLY HIDDEN** | **STRICTLY HIDDEN** (No reporter dashboard) | **STRICTLY HIDDEN** | Stage 5 Approved Decision 2: Reports are strictly confidential one-way inputs. |
| **Received Sanctions** | **STRICTLY HIDDEN** | **STRICTLY HIDDEN** on profile | **STRICTLY HIDDEN** on profile | Sanctions are community-scoped; global profile must not serve as a pillory or shaming board. |
| **Joined Communities** | **STRICTLY HIDDEN** | Yes ("My Communities" private view) | **STRICTLY HIDDEN** | **Locked Decision 4 Enforcement**: Member rosters are hidden. Publicly listing a user's joined communities allows attackers to scrape profiles and reconstruct community membership rosters. |
| **Internal ID / Secrets** | **NEVER EXPOSED** | **NEVER EXPOSED** | **NEVER EXPOSED** | `id`, `passwordHash`, `role`, `sessionTokenHash` omitted from all selectors. |

### C. Service Implementation (`src/features/profiles/service.ts`)
- `getUserProfile(username: string): Promise<PublicUserProfile | null>`:
  - Finds user by lowercase username where `isSuspended: false`.
  - Selects only: `username`, `createdAt`.
- `getUserPosts(username: string, limit = 20, cursor?: string)`:
  - Queries `Post` where `author.username = username` and `isDeleted = false`.
  - Orders by `createdAt DESC, id DESC`.
  - Selects `publicPostSelect` + community summary `{ name, slug }`.
- `getUserComments(username: string, limit = 20, cursor?: string)`:
  - Queries `Comment` where `author.username = username` and `isDeleted = false`.
  - Orders by `createdAt DESC, id DESC`.
  - Selects `publicCommentSelect` + post title and community slug.

---

## 7. Phase 3 — Discovery / Feed

### A. Feed Architecture
1. **Authenticated Home Feed (`/`)**:
   - For an authenticated user who belongs to ≥ 1 community:
     - Query posts where `communityId IN (SELECT communityId FROM Membership WHERE userId = viewerId)` AND `isDeleted = false`.
     - Order: `createdAt DESC, id DESC` (keyset paginated via existing cursor logic).
     - Empty state: If user has joined 0 communities, display "Welcome to Utopia" discovery state with recommended communities to join.
2. **Visitor Global Feed (`/`)**:
   - For signed-out visitors:
     - Query posts where `isDeleted = false` across all communities.
     - Order: `createdAt DESC, id DESC` (keyset paginated).
     - Displays platform activity chronologically without tracking or recommendation algorithms.
3. **Community Directory Discovery (`/c`)**:
   - Add sort options:
     - `newest`: `createdAt DESC` (default).
     - `members`: `memberships._count DESC`.
     - `alphabetical`: `name ASC`.

### B. Performance & Query Strategy
- Keyset pagination must be preserved: `(createdAt, id)` composite cursor prevents offset degradation.
- Multi-community feed query:
  ```sql
  SELECT p.* FROM "Post" p
  WHERE p."communityId" IN (
    SELECT m."communityId" FROM "Membership" m WHERE m."userId" = $viewerId
  )
  AND p."isDeleted" = false
  AND (p."createdAt", p."id") < ($cursorCreatedAt, $cursorId)
  ORDER BY p."createdAt" DESC, p."id" DESC
  LIMIT $limit;
  ```
- Index support: PostgreSQL uses index `Membership_userId_idx` for the subquery and `Post_communityId_isDeleted_createdAt_id_idx` or `Post_createdAt_idx` for the post scan.

---

## 8. Phase 4 — Notifications

### A. Notification Model & Event Triggers
| Event Trigger | Notification Recipient | Actor | Payload Data Stored | Trigger Point |
|---|---|---|---|---|
| **`POST_REPLY`** | Post author | Comment author | `communityId`, `postId`, `commentId` | `createComment` in `content/service.ts` |
| **`COMMENT_REPLY`** | Parent comment author | Child comment author | `communityId`, `postId`, `commentId` | `createComment` in `content/service.ts` |
| **`CONTENT_REMOVED`** | Author of removed post/comment | Acting moderator | `communityId`, `actionType`, public reason | `removePost` / `removeComment` in `moderation/service.ts` |
| **`SANCTION_ISSUED`** | Sanctioned user | Acting moderator | `communityId`, `sanctionType`, expiry, reason | `issueSanction` in `sanctions/service.ts` |
| **`SANCTION_REVOKED`** | Sanctioned user | Acting moderator | `communityId`, public reason | `revokeSanction` in `sanctions/service.ts` |

### B. Anti-Spam & Invariant Rules
1. **No Self-Notifications**: If `recipientUserId === actorId`, no notification is generated.
2. **No Voting Notifications**: Upvotes and downvotes NEVER generate notifications (prevents voter de-anonymization and spam).
3. **No Report Notifications**: Submitting or actioning a report NEVER notifies the reporter or the reported user (preserves Stage 5 Approved Decision 2).
4. **Confidentiality Guard**: Moderation notifications contain only the public `reason`. The moderator's `internalNote` is NEVER copied to `Notification`.
5. **Soft-Delete Cascade**: If a post or comment is removed, existing notifications referencing it retain metadata for historical notice or are safely set null.

### C. Service Interface (`src/features/notifications/service.ts`)
- `listUserNotifications(userId: string, limit = 30, cursor?: string): Promise<{ notifications: PublicNotification[]; nextCursor?: string }>`:
  - Enforces `where: { userId }`.
  - Keyset pagination on `createdAt DESC, id DESC`.
- `getUnreadNotificationCount(userId: string): Promise<number>`:
  - Fast count query: `where: { userId, isRead: false }`.
- `markNotificationAsRead(notificationId: string, userId: string): Promise<void>`:
  - Updates `isRead: true, readAt: now()` where `id = notificationId AND userId = userId`.
- `markAllNotificationsAsRead(userId: string): Promise<void>`:
  - Batch update: `updateMany` where `userId = userId AND isRead: false`.

---

## 9. Phase 5 — UX Improvements

### A. Global Navigation Header (`src/app/layout.tsx`)
Create a persistent top navigation component:
- **Left**: Utopia logo/wordmark (`font-bold tracking-tight text-white`), link to `/`.
- **Center**: Quick-navigation links (`Home`, `Communities`, `Search`).
- **Right**:
  - If signed in:
    - Search quick-icon / search bar.
    - Notification bell with dynamic unread counter badge.
    - User dropdown or direct link to `/u/[username]`.
    - Sign out action button.
  - If signed out:
    - "Sign In" (`/login`).
    - "Register" (`/register`) if `ALLOW_PUBLIC_REGISTRATION=true`, or "Closed Beta" badge if false.

### B. Error, Loading & Empty States
- Root `loading.tsx`: Skeleton loading card feed matching dark palette.
- Root `error.tsx`: User-friendly recovery card with "Try Again" and "Return Home".
- Empty states for:
  - Home feed with 0 memberships ("Join communities to populate your feed").
  - User profile with 0 posts/comments ("This user has not posted any content yet").
  - Search with 0 results ("No matches found for '[query]'. Try different keywords").
  - Notifications with 0 items ("You're all caught up!").

### C. Branding Migration
- Remove residual "Insta-pro" strings in `layout.tsx` metadata and replace with "Utopia | Community-First Pseudonymous Social Platform".
- Update page titles across `/c`, `/login`, `/register`, and `/c/[slug]` to consistently use "Utopia".

---

## 10. Database & Migration Plan

### Proposed Schema Changes

#### 1. Add Enum `NotificationType`
```prisma
enum NotificationType {
  POST_REPLY
  COMMENT_REPLY
  CONTENT_REMOVED
  SANCTION_ISSUED
  SANCTION_REVOKED
}
```

#### 2. Add Model `Notification`
```prisma
model Notification {
  id          String           @id @default(cuid())
  userId      String           // Recipient
  actorId     String?          // User who triggered event (nullable for system)
  communityId String           // Scoped community
  type        NotificationType
  postId      String?
  commentId   String?
  message     String           @db.VarChar(300) // Sanitized public message
  isRead      Boolean          @default(false)
  readAt      DateTime?
  createdAt   DateTime         @default(now())

  user      User      @relation("UserNotifications", fields: [userId], references: [id], onDelete: Cascade)
  actor     User?     @relation("TriggeredNotifications", fields: [actorId], references: [id], onDelete: SetNull)
  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  post      Post?     @relation(fields: [postId], references: [id], onDelete: Cascade)
  comment   Comment?  @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@index([userId, isRead, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
  @@index([communityId])
}
```

#### 3. Update Model `User` Relations
Add the two reverse relations to `User`:
```prisma
notifications        Notification[] @relation("UserNotifications")
notificationsTriggered Notification[] @relation("TriggeredNotifications")
```

#### 4. PostgreSQL Full-Text Search Migration
In addition to the Notification model, a migration SQL script will add PostgreSQL GIN indexes for full-text search:
```sql
-- Post full-text search index
CREATE INDEX "Post_title_body_search_idx" ON "Post"
USING gin(to_tsvector('english', "title" || ' ' || "body"))
WHERE "isDeleted" = false;

-- Community search index
CREATE INDEX "Community_name_desc_search_idx" ON "Community"
USING gin(to_tsvector('english', "name" || ' ' || "description"));
```

### Features Requiring ZERO Schema Changes:
- Profiles (`/u/[username]`) — uses existing `User`, `Post`, `Comment` models.
- Home Feed (`/`) — uses existing `Membership` and `Post` indexes.
- UX Navigation, loading/error states, and branding.

---

## 11. Authorization & Privacy Matrix

| Action / Resource | Anonymous | Authenticated Non-Member | Community Member | Moderator / Owner | Profile Owner |
|---|---|---|---|---|---|
| **Search Communities / Posts / Users** | Allowed | Allowed | Allowed | Allowed | Allowed |
| **View User Profile Header** | Allowed | Allowed | Allowed | Allowed | Allowed |
| **View User Post / Comment History** | Allowed (`isDeleted: false`) | Allowed (`isDeleted: false`) | Allowed (`isDeleted: false`) | Allowed (`isDeleted: false`) | Allowed (own deleted tagged) |
| **View User Joined Communities** | **Denied (Hidden)** | **Denied (Hidden)** | **Denied (Hidden)** | **Denied (Hidden)** | **Allowed (Private tab)** |
| **View User Votes** | **Denied (Hidden)** | **Denied (Hidden)** | **Denied (Hidden)** | **Denied (Hidden)** | **Allowed (Private tab)** |
| **View User Sanctions on Profile** | **Denied (Hidden)** | **Denied (Hidden)** | **Denied (Hidden)** | **Denied (Hidden)** | **Denied (Hidden)** |
| **View User Notifications** | Denied (401) | Denied (403: Own only) | Denied (403: Own only) | Denied (403: Own only) | **Allowed (Own only)** |
| **Mark Notification Read** | Denied (401) | Denied (403: Own only) | Denied (403: Own only) | Denied (403: Own only) | **Allowed (Own only)** |
| **View Home Feed (Joined Communities)** | Shows Global Feed | Shows Global Feed (if 0 joined) | Allowed (Joined feed) | Allowed (Joined feed) | Allowed (Joined feed) |

---

## 12. Service & API Boundaries

Following the established modular monolith pattern:

```
src/
  features/
    profiles/
      service.ts        # getUserProfile, getUserPosts, getUserComments
      validation.ts     # usernameParamSchema, profileQuerySchema
      components/
        profile-header.tsx
        profile-feed.tsx
    search/
      service.ts        # searchCommunities, searchPosts, searchUsers
      validation.ts     # searchQuerySchema
      components/
        search-bar.tsx
        search-results.tsx
    feed/
      service.ts        # getHomeFeed, getGlobalDiscoveryFeed
      validation.ts     # feedFilterSchema
    notifications/
      service.ts        # createNotification, listUserNotifications, markAsRead
      actions.ts        # markReadAction, markAllReadAction
      validation.ts     # notificationQuerySchema
      components/
        notification-item.tsx
        notification-badge.tsx
    content/
      service.ts        # instrumented with notification trigger on comment creation
    moderation/
      service.ts        # instrumented with notification trigger on removal/sanction
  lib/
    transaction.ts      # Consolidated executeWithRetry helper
```

---

## 13. Testing Strategy

All tests will run strictly against `TEST_DATABASE_URL` on port 5433 (`instapro_test`) with sequential execution (`--no-file-parallelism`).

### A. Profiles Integration Tests (`tests/integration/profiles.test.ts`)
- Profile lookup by username returns exact public metadata.
- Suspended user returns null/not found.
- Profile post list returns only active posts (`isDeleted: false`).
- Profile comment list returns only active comments (`isDeleted: false`).
- Privacy boundary: confirms `passwordHash`, `role`, `sessions`, `reportsFiled`, and `sanctionsReceived` are `undefined` or omitted.
- Privacy boundary: confirms joined community roster cannot be queried by non-owner.

### B. Search Integration Tests (`tests/integration/search.test.ts`)
- Community search matches by exact slug, name substring, and description text.
- Post search matches title and body.
- Soft-deleted posts are strictly excluded from search results.
- User search matches prefix only and excludes suspended users.
- Search query validation rejects queries < 2 characters or > 100 characters.
- Deterministic pagination bounds.

### C. Home Feed Integration Tests (`tests/integration/feed.test.ts`)
- Authenticated user with memberships sees posts only from joined communities.
- User joining a new community immediately sees that community's posts in home feed.
- User leaving a community immediately stops seeing that community's posts.
- Soft-deleted posts are excluded from home feed.
- Deterministic keyset pagination behaves correctly across multi-community results.
- Unauthenticated user receives global chronological discovery feed.

### D. Notifications Integration Tests (`tests/integration/notifications.test.ts`)
- Creating a comment creates a notification for post author.
- Creating a nested comment creates a notification for parent comment author.
- Replying to one's own post/comment does NOT generate a notification.
- Removing a post generates a `CONTENT_REMOVED` notification with public reason.
- Moderation `internalNote` is NEVER present in notification record.
- Issuing a sanction generates `SANCTION_ISSUED` notification with duration.
- User can only query and mark their own notifications.
- Marking one or all notifications as read updates `isRead` and `readAt`.

### E. Regression Assertion
- All 110 existing Stage 1–5 tests continue to pass with 0 failures.

---

## 14. Performance & Abuse Controls

1. **Query Limits**: All search, feed, profile, and notification queries enforce strict server-side limit clamps (max 50 items).
2. **PostgreSQL Full-Text GIN Indexes**: Searching across posts uses pre-computed tsvector expressions on non-deleted records, avoiding full-table sequential scans.
3. **Index-Backed Keyset Pagination**: Feeds avoid `OFFSET` degradation by using indexed composite conditions `(createdAt, id) < (cursorCreatedAt, cursorId)`.
4. **Anti-Scraping Membership Guard**: User profiles do not list joined communities to third parties, preserving the Stage 3B locked decision against membership harvesting.
5. **Pre-Launch Registration Gate**: Public registration remains disabled (`ALLOW_PUBLIC_REGISTRATION=false`) until unauthenticated abuse controls are introduced.
6. **Notification Rate Limiting**: Notifications are only generated as side effects of authenticated actions (`createComment`, `removePost`, `issueSanction`), preventing external notification flooding.

---

## 15. Explicitly Deferred Scope (NOT IN STAGE 6)

The following items are intentionally deferred to future stages to prevent architectural bloat:
- **Direct Messaging (DMs) & 1-on-1 Chat**: Requires end-to-end encryption or distinct relational semantics.
- **Realtime WebSockets / SSE**: Notifications and feeds in Stage 6 are pull-based on page load / navigation. Realtime socket servers are deferred.
- **Email, Push, or SMS Notifications**: No PII (email/phone) is collected in Utopia; external messaging requires out-of-band architecture.
- **Media / Image / Video Uploads**: Utopia remains strictly plain text in Stage 6 per Core Principle #5.
- **AI / Algorithmic / Engagement-Optimized Recommendation Feeds**: Utopia remains strictly deterministic and chronological per Core Principle #4.
- **External Search Engines (Elasticsearch, Algolia, Meilisearch)**: PostgreSQL native capabilities are sufficient for V1 scale.
- **Platform-Wide Moderation Dashboard**: Moderation remains community-scoped.

---

## 16. Recommended Implementation Order

### Phase 0: Shared Refactoring & Layout Foundations
- **Objective**: Consolidate redundant retry helpers and establish persistent global navigation.
- **Files**: `src/lib/transaction.ts`, `src/app/layout.tsx`, `src/app/globals.css`.
- **Database Changes**: None.
- **Tests**: Verify all 110 existing tests pass.

### Phase 1: Profiles
- **Objective**: Implement pseudonymous profile views.
- **Files**: `src/features/profiles/*`, `src/app/u/[username]/page.tsx`.
- **Database Changes**: None.
- **Tests**: `tests/integration/profiles.test.ts` (new).

### Phase 2: Search
- **Objective**: Implement community, post, and user search.
- **Files**: `src/features/search/*`, `src/app/search/page.tsx`, `prisma/migrations/20260904XXXXXX_add_search_indexes`.
- **Database Changes**: GIN indexes for Post and Community.
- **Tests**: `tests/integration/search.test.ts` (new).

### Phase 3: Discovery & Home Feed
- **Objective**: Implement joined-community home feed on `/` and community discovery.
- **Files**: `src/features/feed/*`, `src/app/page.tsx`, `src/features/communities/service.ts`.
- **Database Changes**: None.
- **Tests**: `tests/integration/feed.test.ts` (new).

### Phase 4: Notifications
- **Objective**: In-app notification engine for replies and moderation events.
- **Files**: `src/features/notifications/*`, `src/features/content/service.ts`, `src/features/moderation/service.ts`, `src/features/sanctions/service.ts`, `src/app/notifications/page.tsx`, `prisma/migrations/20260904XXXXXX_add_notifications`.
- **Database Changes**: `Notification` model and `NotificationType` enum.
- **Tests**: `tests/integration/notifications.test.ts` (new).

### Phase 5: UX Polish & Release Gate
- **Objective**: Loading/error boundaries, mobile responsive drawer, accessibility, final release gate.
- **Files**: `src/app/loading.tsx`, `src/app/error.tsx`, components polish.
- **Database Changes**: None.
- **Tests**: Full test suite run (all regression + new tests), production build verification.

---

## 17. Stage 6 Release Gate

Stage 6 completion requires meeting all the following criteria:
1. **Feature Implementation**:
   - Profiles: `/u/[username]` operational, displaying public posts/comments with zero PII or private metadata leaks.
   - Search: `/search` operational for communities, posts, and user handles.
   - Feed: `/` serves joined-community feed for authenticated users and global chronological feed for visitors.
   - Notifications: In-app notifications functional for replies, content removals, and sanctions; unread badge functional; mark as read operational.
   - UX: Persistent top navbar, loading skeleton, error boundary, and Utopia branding active.
2. **Security & Privacy Verification**:
   - Profiles do not expose global `User.role`, `passwordHash`, sessions, reports, or sanctions.
   - Profiles do not publicly expose joined communities to third parties.
   - Moderation `internalNote` and reporter identity are never copied into notifications.
   - Search inputs are strictly sanitized and bounded.
3. **Database Integrity**:
   - Clean Prisma migrations with zero schema drifts or manual edits to historical migrations.
   - Bounded queries with GIN/composite indexes.
4. **Test & Build Verification**:
   - 100% of Stage 1–5 integration tests (110 tests) pass with zero regressions.
   - All new Stage 6 integration tests pass against isolated test database `instapro_test`.
   - `npm run build` succeeds with exit code 0.
   - Working tree clean with zero untracked artifacts.

---

## 18. Risks & Open Questions

1. **PostgreSQL GIN Full-Text Indexing in Migrations**:
   - *Risk*: Raw SQL `CREATE INDEX ... USING gin(to_tsvector(...))` is required because Prisma schema does not natively represent functional expression indexes without raw SQL migrations.
   - *Mitigation*: Include the index definition directly inside the generated Prisma migration SQL, following the pattern established in migration 1 (`check_report_target_exactly_one`) and migration 4 (`partial_unique_pending_reports`).
2. **Member Roster Leakage via Joined Communities**:
   - *Risk*: Displaying a user's joined communities on their public profile would allow scrapers to reconstruct community membership rosters, violating Locked Decision #4.
   - *Resolution*: Joined communities are displayed **strictly on the viewer's own profile** ("My Communities" tab) and completely hidden when viewing another user's profile.
3. **Notification Volume for High-Activity Content**:
   - *Risk*: A viral post could generate hundreds of reply notifications for the author.
   - *Mitigation*: Limit notifications query to latest 50, provide "Mark all as read", and evaluate future notification aggregation (e.g. "X and 4 others replied") in Stage 7.

---

## Audit Evidence

### Files Inspected
- `README.md`
- `CONTRIBUTING.md`
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `next.config.ts`
- `docs/PROJECT_CONTEXT.md`
- `docs/AI_HANDOFF.md`
- `docs/STAGE5_PLAN.md`
- `prisma/schema.prisma`
- `prisma/migrations/20260903000000_init_with_report_check/migration.sql`
- `prisma/migrations/20260903213816_optimize_community_feed_index/migration.sql`
- `prisma/migrations/20260904000000_drop_moderation_action_report_unique/migration.sql`
- `prisma/migrations/20260904052000_partial_unique_pending_reports/migration.sql`
- `src/lib/db.ts`
- `src/features/auth/service.ts`, `session.ts`, `crypto.ts`, `password.ts`, `validation.ts`, `actions.ts`
- `src/features/communities/service.ts`, `permissions.ts`, `validation.ts`, `actions.ts`
- `src/features/content/service.ts`, `validation.ts`, `actions.ts`
- `src/features/votes/service.ts`, `validation.ts`, `actions.ts`
- `src/features/reports/service.ts`, `validation.ts`, `actions.ts`
- `src/features/sanctions/service.ts`, `guards.ts`, `validation.ts`, `actions.ts`
- `src/features/moderation/service.ts`, `audit.ts`, `validation.ts`, `actions.ts`
- `src/app/layout.tsx`, `page.tsx`, `globals.css`
- `src/app/c/page.tsx`, `src/app/c/create/page.tsx`
- `src/app/c/[slug]/page.tsx`, `src/app/c/[slug]/modlog/page.tsx`
- `src/app/c/[slug]/post/[postId]/page.tsx`, `src/app/c/[slug]/post/create/page.tsx`
- `tests/helpers/test-db.ts`
- `tests/integration/auth.test.ts`
- `tests/integration/community.test.ts`
- `tests/integration/content.test.ts`
- `tests/integration/moderation.test.ts`
- `tests/integration/modlog.test.ts`
- `tests/integration/reports.test.ts`
- `tests/integration/safety-isolation.test.ts`
- `tests/integration/sanctions.test.ts`
- `tests/integration/stage1-foundation.test.ts`
- `tests/integration/votes.test.ts`

### Commands Executed & Verified Results
1. `npm test`: Passed 10/10 test files, **110/110 tests passed** in 95.29s against isolated test database `instapro_test` on port 5433.
2. `npm run build`: Production Next.js 15 build compiled with **0 errors**, generating all 8 static/dynamic routes.
3. `git status`: Working tree confirmed clean.

### Existing Applied Migrations
1. `20260903000000_init_with_report_check`
2. `20260903213816_optimize_community_feed_index`
3. `20260904000000_drop_moderation_action_report_unique`
4. `20260904052000_partial_unique_pending_reports`

### Existing App Routes
- `/` (landing page)
- `/login` (login page)
- `/register` (registration page, gated)
- `/c` (public communities directory)
- `/c/create` (authenticated community creation)
- `/c/[slug]` (community detail & feed)
- `/c/[slug]/modlog` (public moderation transparency log)
- `/c/[slug]/post/create` (create post)
- `/c/[slug]/post/[postId]` (post detail, comment tree, vote & mod controls)
