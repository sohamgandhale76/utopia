// =============================================================================
// scripts/start-test-db.ts
// =============================================================================
// Starts an isolated PostgreSQL instance on port 5433 for the test database.
//
// Uses the PostgreSQL binaries bundled with @embedded-postgres/windows-x64
// via pg_ctl directly, bypassing the embedded-postgres JS wrapper entirely.
// The JS wrapper calls `import { userInfo } from "os"` which fails with
// ENOMEM on this Windows host — a libuv bug we cannot patch because named
// ES module imports bind directly to the export and are immutable.
//
// Usage:  npm run db:test
//         (or: npx tsx scripts/start-test-db.ts)
// =============================================================================

import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import { Client } from "pg";
import net from "net";

const TEST_PORT = 5433;
const DATA_DIR = path.resolve(process.cwd(), ".local-test-db-data");
const BIN_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "@embedded-postgres",
  "windows-x64",
  "native",
  "bin"
);
const PG_CTL = path.join(BIN_DIR, "pg_ctl.exe");
const INITDB = path.join(BIN_DIR, "initdb.exe");

function binExists(): boolean {
  return fs.existsSync(PG_CTL) && fs.existsSync(INITDB);
}

async function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => { resolve(false); });
    socket.connect(port, host);
  });
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`PostgreSQL did not become ready on port ${port} within ${timeoutMs}ms`);
}

async function main() {
  if (!binExists()) {
    console.error(
      "PostgreSQL binaries not found at:\n" +
      `  ${BIN_DIR}\n\n` +
      "Install the native package:\n" +
      "  npm install\n\n" +
      "Or start a standalone PostgreSQL 16 server on port 5433 manually.\n" +
      "See docs/PROJECT_CONTEXT.md for instructions."
    );
    process.exit(1);
  }

  // Check if already running
  if (await isPortOpen(TEST_PORT)) {
    console.log(`PostgreSQL is already running on port ${TEST_PORT}.`);
  } else {
    // Initialize data directory if needed
    if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
      console.log(`Initializing PostgreSQL data directory: ${DATA_DIR}`);
      execSync(
        `"${INITDB}" -D "${DATA_DIR}" -U postgres -A trust --encoding=UTF8`,
        { stdio: "inherit" }
      );
    }

    // Start PostgreSQL via pg_ctl
    console.log(`Starting PostgreSQL on port ${TEST_PORT}...`);
    execSync(
      `"${PG_CTL}" -D "${DATA_DIR}" -o "-p ${TEST_PORT}" -l "${path.join(DATA_DIR, "server.log")}" start`,
      { stdio: "inherit" }
    );

    await waitForPort(TEST_PORT);
    console.log(`PostgreSQL is ready on port ${TEST_PORT}.`);
  }

  // Ensure instapro_test database exists
  const client = new Client({
    connectionString: `postgresql://postgres:postgres@localhost:${TEST_PORT}/postgres`,
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

  console.log(`\nTest database ready at: postgresql://postgres:postgres@localhost:${TEST_PORT}/instapro_test`);
  console.log(`\nTo run tests:  npm test`);
  console.log(`To stop:       npm run db:test:stop`);
  
  console.log(`\nKeeping process alive to maintain database process...`);
  // Keep process alive so Windows doesn't kill the child pg_ctl process
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  
  // Set an interval to keep the event loop active
  setInterval(() => {}, 1000 * 60 * 60);
}

main().catch((err) => {
  console.error("Failed to start test database:", err.message || err);
  process.exit(1);
});
