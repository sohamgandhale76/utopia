import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { execSync } from "child_process";
import net from "net";
import dotenv from "dotenv";

dotenv.config();

let prisma: PrismaClient | null = null;

export const EXPECTED_TEST_DB = "instapro_test";
export const DEFAULT_TEST_PORT = 5433;

/**
 * Validates and returns the TEST_DATABASE_URL.
 * Strictly asserts that:
 * 1. TEST_DATABASE_URL is provided (refuses silent fallback to DATABASE_URL).
 * 2. TEST_DATABASE_URL does NOT target the development database 'instapro'.
 * 3. TEST_DATABASE_URL strictly targets 'instapro_test'.
 */
export function getTestDatabaseUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl || testUrl.trim() === "") {
    throw new Error(
      "Safety Violation: TEST_DATABASE_URL environment variable is required for tests. Refusing to fall back to DATABASE_URL."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error(`Invalid TEST_DATABASE_URL format: ${testUrl}`);
  }

  const dbName = parsed.pathname.replace(/^\//, "");
  if (dbName === "instapro") {
    throw new Error(
      "Safety Violation: TEST_DATABASE_URL targets the development database 'instapro'. Refusing to run tests against development database."
    );
  }

  if (dbName !== EXPECTED_TEST_DB) {
    throw new Error(
      `Safety Violation: TEST_DATABASE_URL must target database '${EXPECTED_TEST_DB}'. Received: '${dbName}'`
    );
  }

  return testUrl;
}

async function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export async function getTestPrisma(): Promise<PrismaClient> {
  if (prisma) return prisma;

  // 1. Strict URL validation
  const testUrl = getTestDatabaseUrl();
  const parsedUrl = new URL(testUrl);
  const testPort = parseInt(parsedUrl.port || String(DEFAULT_TEST_PORT), 10);
  const testHost = parsedUrl.hostname || "127.0.0.1";

  // 2. Require an externally running PostgreSQL instance on the test port.
  //    embedded-postgres is NOT used here because it internally calls
  //    `import { userInfo } from "os"` which fails with ENOMEM on this
  //    Windows host, and that named import binding cannot be monkey-patched.
  const isOpen = await isPortOpen(testPort, testHost);
  if (!isOpen) {
    throw new Error(
      `[Test DB] PostgreSQL is not running on ${testHost}:${testPort}.\n` +
      `The test suite requires an external PostgreSQL instance serving 'instapro_test'.\n` +
      `Start one with: npm run db:test\n` +
      `Or see docs/PROJECT_CONTEXT.md for manual PostgreSQL 16 setup instructions.`
    );
  }

  // 3. Connect to administrative postgres database to ensure instapro_test exists
  const adminUrl = `postgresql://${parsedUrl.username}:${parsedUrl.password}@${testHost}:${testPort}/postgres?schema=public`;
  const adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    const res = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1;`,
      [EXPECTED_TEST_DB]
    );
    if (res.rows.length === 0) {
      console.log(`[Test DB] Creating database '${EXPECTED_TEST_DB}'...`);
      await adminClient.query(`CREATE DATABASE ${EXPECTED_TEST_DB};`);
    }
  } finally {
    await adminClient.end();
  }

  // 4. Connect to instapro_test and verify current_database() before running migrations
  const verifyClient = new Client({ connectionString: testUrl });
  await verifyClient.connect();
  try {
    const check = await verifyClient.query("SELECT current_database();");
    const currentDb = check.rows[0]?.current_database;
    if (currentDb !== EXPECTED_TEST_DB) {
      throw new Error(
        `Safety Violation: Connected to '${currentDb}', expected '${EXPECTED_TEST_DB}'. Refusing to run migrations.`
      );
    }
  } finally {
    await verifyClient.end();
  }

  // 5. Apply migrations using 'npx prisma migrate deploy' with DATABASE_URL=testUrl
  console.log(`[Test DB] Running 'prisma migrate deploy' against '${EXPECTED_TEST_DB}'...`);
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  execSync(`${npxCmd} prisma migrate deploy`, {
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
    },
    stdio: "inherit",
  });

  // 6. Instantiate test PrismaClient
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: testUrl,
      },
    },
  });

  // 7. Verify PrismaClient is connected to instapro_test
  const checkPrisma = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>(
    "SELECT current_database();"
  );
  const connectedDb = checkPrisma[0]?.current_database;
  if (connectedDb !== EXPECTED_TEST_DB) {
    await prisma.$disconnect();
    prisma = null;
    throw new Error(
      `Safety Assertion Failed: Connected to database '${connectedDb}', but expected '${EXPECTED_TEST_DB}'. Aborting.`
    );
  }

  return prisma;
}

export async function resetTestDatabase(): Promise<void> {
  const client = await getTestPrisma();

  // Safety Assertion: Never truncate unless current_database() is exactly instapro_test
  const check = await client.$queryRawUnsafe<Array<{ current_database: string }>>(
    "SELECT current_database();"
  );
  const currentDb = check[0]?.current_database;
  if (currentDb !== EXPECTED_TEST_DB) {
    throw new Error(
      `Safety Assertion Failed: Attempted to truncate database '${currentDb}'. Table truncation is strictly forbidden on non-test databases!`
    );
  }

  await client.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "RateLimitBucket",
      "ModerationAction",
      "Report",
      "CommentVote",
      "PostVote",
      "Comment",
      "Post",
      "CommunitySanction",
      "Membership",
      "Community",
      "Session",
      "User"
    CASCADE;
  `);
}

export async function closeTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
