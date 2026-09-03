# Insta-pro

An open-source, pseudonymous, community-first social platform where users can be anonymous to each other, but not free from accountability.

## Core Principles
- **Pseudonymous by default**: One public handle per account (`[a-z0-9_]{3,24}`). No phone number, no email, and zero PII collected.
- **Accountability via Persistent Pseudonyms & Sanctions**: Actions leave an auditable trail. Rule violations result in explicit, scoped sanctions (`MUTE` or `BAN`).
- **Append-only Application Audit Logs**: All moderation actions publicly record the acting moderator's username and public reason.
- **Explainable Feeds**: Chronological ordering only; no black-box recommendation models.
- **Plain Text Only**: V1 posts and comments are strictly plain text (zero Markdown or HTML parsing).

---

## Security Gate Notice

> **IMPORTANT**: Public registration is **DISABLED by default** (`ALLOW_PUBLIC_REGISTRATION=false`).
> 
> Because per-account rate limiting does not protect against unauthenticated bot floods, public registration must not be enabled until an abuse-control mechanism (e.g. proof-of-work challenge, CAPTCHA, or invite system) is implemented. This repository is currently in closed development/pilot mode.

---

## Local Development Setup

### Prerequisites
- Node.js 20+ (Node.js 24 recommended)
- npm 10+
- Docker & Docker Compose (or local PostgreSQL 16)

### Quickstart

1. **Clone the repository and install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```

3. **Start PostgreSQL**:
   ```bash
   # Using Docker Compose:
   npm run db:up

   # Or in local development without Docker:
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

6. **Run automated test suite**:
   ```bash
   npm test
   ```

---

## Database Environment & Testing Isolation

### Preferred Environments
- **Docker Compose (`docker-compose.yml`)** or a **native PostgreSQL 16 server** is the preferred and authoritative database environment for development and production.

### Local Windows Fallback (`embedded-postgres`)
- `embedded-postgres` is included strictly as an **optional, non-production convenience fallback** for Windows development and automated testing in environments where Docker is unavailable.
- Its dependencies (`embedded-postgres` and `@embedded-postgres/windows-x64`) are **pinned to exact versions** (`18.4.0-beta.17`) to avoid non-deterministic beta upgrades.
- It must **never** be used as production infrastructure.

### Test Database Isolation Guarantee
- Testing requires `TEST_DATABASE_URL` explicitly targeting `instapro_test` on port `5433` (data directory: `.local-test-db-data`).
- Test scripts and helpers strictly assert that `current_database() === 'instapro_test'`.
- The test harness will **never** connect to, truncate, or alter the development database `instapro`.
