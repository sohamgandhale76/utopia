# Utopia

A new social platform built around communities, conversations, and bringing people together.

It's still under development, but I've reached a point where I want to stop building completely in isolation and start getting real people involved.

---

## 🛠️ If you're a developer...

I'm looking for contributors who want to get their hands on the project and help build this thing.

You can contribute by:

- Building new features
- Debugging and fixing issues
- Reviewing code
- Improving architecture
- Finding security and edge-case problems
- Improving performance
- Working on UI/UX
- Writing tests
- Suggesting better ways to build things

You don't need to be an expert. If you're interested in learning while working on a real product, you're welcome.

See [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

---

## 👥 If you're a user...

I'm also looking for people who don't code.

I want early users to actually try this platform, use it, and tell me what's broken, confusing, or missing. You don't need to open issues or write reports — just be real about what works and what doesn't.

Honest criticism is welcome. I don't want people to tell me something is good just because I built it.

---

## What is Utopia?

Utopia is an open-source, pseudonymous, community-first social platform.

- **Pseudonymous by default** — One public handle per account (`[a-z0-9_]{3,24}`). No phone number, no email, zero PII collected.
- **Accountability via persistent pseudonyms & sanctions** — Actions leave an auditable trail. Rule violations result in explicit, scoped sanctions (`MUTE` or `BAN`).
- **Append-only moderation audit logs** — All moderation actions publicly record the acting moderator's username and public reason.
- **Explainable feeds** — Chronological ordering only; no black-box recommendation models.
- **Plain text only** — V1 posts and comments are strictly plain text (no Markdown or HTML).

---

## Current Status

The project has completed Stage 5, which includes:

- ✅ Voting system
- ✅ Reporting system (with DB-level duplicate prevention)
- ✅ Sanctions (MUTE / BAN) with community scope
- ✅ Content moderation (remove / restore)
- ✅ ModerationAction audit logging
- ✅ Community moderation transparency log
- ✅ Privacy-first architecture (no PII leakage in public projections)
- ✅ Security and authorization boundaries
- ✅ 110 integration tests passing
- ✅ Production build passing

---

## ⚠️ Security Gate

> **IMPORTANT**: Public registration is **DISABLED by default** (`ALLOW_PUBLIC_REGISTRATION=false`).
>
> Because per-account rate limiting does not protect against unauthenticated bot floods, public registration must not be enabled until an abuse-control mechanism (e.g. proof-of-work challenge, CAPTCHA, or invite system) is implemented. The platform is currently in closed development/pilot mode.

---

## Local Development Setup

### Prerequisites

- Node.js 20+ (Node.js 24 recommended)
- npm 10+
- Docker & Docker Compose (or local PostgreSQL 16)

### Quickstart

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/utopia.git
   cd utopia
   npm ci
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env and fill in your values
   ```

3. **Start PostgreSQL**:
   ```bash
   # Using Docker Compose:
   npm run db:up

   # Or in local development without Docker (Windows):
   npm run db:local
   ```

4. **Run database migrations**:
   ```bash
   npm run prisma:migrate
   ```

5. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

6. **Run the automated test suite**:
   ```bash
   npm test
   ```

---

## Database Environment & Testing Isolation

### Preferred Environments
- **Docker Compose (`docker-compose.yml`)** or a **native PostgreSQL 16 server** is the preferred and authoritative database environment for development and production.

### Local Windows Fallback (`embedded-postgres`)
- `embedded-postgres` is included strictly as an **optional, non-production convenience fallback** for Windows development and automated testing in environments where Docker is unavailable.
- Its dependencies are **pinned to exact versions** (`18.4.0-beta.17`) to avoid non-deterministic beta upgrades.
- It must **never** be used as production infrastructure.

### Test Database Isolation Guarantee
- Testing requires `TEST_DATABASE_URL` explicitly targeting `instapro_test` on port `5433`.
- The test harness strictly asserts `current_database() === 'instapro_test'` at runtime.
- The test harness will **never** connect to, truncate, or alter the development database.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL 16 |
| ORM | Prisma 6 |
| Styling | Tailwind CSS |
| Testing | Vitest (integration) |
| Auth | Custom session tokens (no OAuth) |

---

## License

This project does not currently have a license. If you want to use it, fork it, or contribute — just reach out or open an issue.
