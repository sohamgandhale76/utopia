import os from "os";

// =============================================================================
// SAFEGUARD: Monkey-patch os.userInfo BEFORE embedded-postgres is loaded.
// See tests/helpers/test-db.ts for full explanation.
// embedded-postgres is imported dynamically below (await import) so this
// patch executes first.
// =============================================================================
const origUserInfo = os.userInfo;
os.userInfo = function (options?: any) {
  try {
    return origUserInfo.call(os, options);
  } catch {
    return {
      uid: -1,
      gid: -1,
      username: process.env.USERNAME || "postgres",
      homedir: process.env.USERPROFILE || "",
      shell: null,
    };
  }
};

// NOTE: Do NOT add `import EmbeddedPostgres from "embedded-postgres"` here.
// Static imports are hoisted before module body code, which would cause
// embedded-postgres to call os.userInfo() before the patch above runs.

import path from "path";
import fs from "fs";
import { Client } from "pg";

async function main() {
  const dataDir = path.resolve(process.cwd(), ".local-test-db-data");
  const port = 5433;

  // Dynamic import: embedded-postgres is loaded AFTER the os.userInfo patch
  const { default: EmbeddedPostgres } = await import("embedded-postgres");

  const pg = new (EmbeddedPostgres as any)({
    databaseDir: dataDir,
    port: port,
    user: "postgres",
    password: "postgres",
    initialDatabase: "postgres",
  });

  if (!fs.existsSync(dataDir)) {
    console.log("Initialising test PostgreSQL data cluster in .local-test-db-data...");
    await pg.initialise();
  }

  console.log(`Starting isolated test PostgreSQL on port ${port}...`);
  await pg.start();
  console.log(`Test PostgreSQL running at postgresql://postgres:postgres@localhost:${port}/postgres`);

  // Ensure instapro_test database exists
  const client = new Client({
    connectionString: `postgresql://postgres:postgres@localhost:${port}/postgres?schema=public`,
  });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = 'instapro_test';`
    );
    if (res.rows.length === 0) {
      console.log("Creating database 'instapro_test'...");
      await client.query("CREATE DATABASE instapro_test;");
      console.log("Database 'instapro_test' created.");
    } else {
      console.log("Database 'instapro_test' already exists.");
    }
  } finally {
    await client.end();
  }

  console.log(`Ready for tests at: postgresql://postgres:postgres@localhost:${port}/instapro_test?schema=public`);

  const shutdown = async () => {
    console.log("Stopping test PostgreSQL...");
    await pg.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Failed to start test database:", err);
  process.exit(1);
});
