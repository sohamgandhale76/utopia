# Contributing to Utopia

Thank you for your interest in contributing. Here's everything you need to get started.

---

## How to Contribute

### Reporting Bugs

If you find a bug:

1. Check [existing issues](../../issues) to see if it's already reported.
2. Open a new issue with:
   - A clear title
   - Steps to reproduce
   - What you expected vs what happened
   - Your environment (OS, Node version, browser if applicable)

### Suggesting Features

Open an issue with the `enhancement` label. Describe:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

### Submitting Code

1. **Fork** the repository.
2. **Create a branch** from `master`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. **Make your changes** — keep them focused and minimal.
4. **Run the tests** before submitting:
   ```bash
   npm test
   ```
5. **Open a Pull Request** against `master` with a clear description of what you changed and why.

---

## Development Guidelines

- **TypeScript everywhere** — no `any` unless absolutely necessary and justified in a comment.
- **Zod for all user input** — every server action validates with a Zod schema before touching the database.
- **No PII in public projections** — user handles are public; email/passwordHash/session tokens are never returned from service functions.
- **Server Actions for mutations** — all writes go through `src/features/*/actions.ts`.
- **Integration tests for new features** — add tests in `tests/integration/`. See existing test files for patterns.
- **No raw SQL** — use Prisma unless there is a specific reason (e.g., a migration SQL file). Document the reason.
- **Serializable transactions for concurrent writes** — use the `executeWithRetry` pattern in `src/lib/db.ts` for operations that need conflict detection.

---

## Project Structure

```
src/
  app/              # Next.js App Router pages and layouts
  features/         # Feature modules (auth, communities, posts, votes, reports, sanctions, moderation)
    */
      actions.ts    # Server Actions (entry points for mutations)
      service.ts    # Business logic
      validation.ts # Zod schemas
      components/   # Feature-specific React components
  lib/              # Shared utilities (db client, session, error helpers)

prisma/
  schema.prisma     # Database schema
  migrations/       # Migration history (never edit existing migrations)

tests/
  integration/      # Vitest integration tests (require TEST_DATABASE_URL)
  helpers/          # Test database setup and teardown utilities

docs/               # Project documentation and stage plans
scripts/            # Dev/test database helpers
```

---

## Setting Up the Test Database

Tests require a **separate** PostgreSQL instance on port `5433` with a database named `instapro_test`.

Using the embedded fallback (Windows, no Docker):
```bash
npm run db:test
```

Using Docker Compose:
```bash
# Edit docker-compose.yml to expose port 5433 for the test DB
```

Set your `.env`:
```
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/instapro_test
```

Then run:
```bash
npm test
```

The test harness enforces at runtime that it is connected to `instapro_test` — it will refuse to run against the development database.

---

## Code of Conduct

Be respectful. Honest criticism of the code is welcome and encouraged. Personal attacks or harassment are not.

---

## Questions?

Open an issue. That's the best place for anything that isn't a straightforward bug or PR.
