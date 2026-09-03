// =============================================================================
// scripts/stop-test-db.ts
// =============================================================================
// Stops the isolated PostgreSQL test instance started by start-test-db.ts.
// Usage:  npm run db:test:stop
// =============================================================================

import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const DATA_DIR = path.resolve(process.cwd(), ".local-test-db-data");
const PG_CTL = path.resolve(
  process.cwd(),
  "node_modules",
  "@embedded-postgres",
  "windows-x64",
  "native",
  "bin",
  "pg_ctl.exe"
);

if (!fs.existsSync(PG_CTL)) {
  console.error("pg_ctl.exe not found. Is @embedded-postgres/windows-x64 installed?");
  process.exit(1);
}

try {
  execSync(`"${PG_CTL}" -D "${DATA_DIR}" stop -m fast`, { stdio: "inherit" });
  console.log("Test PostgreSQL stopped.");
} catch {
  console.log("Test PostgreSQL was not running or already stopped.");
}
