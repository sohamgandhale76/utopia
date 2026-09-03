import { PrismaClient } from "@prisma/client";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import path from "path";
import fs from "fs";
import net from "net";
import dotenv from "dotenv";

// Load environment variables from .env if not already loaded
dotenv.config();

let embeddedTestPgInstance: any = null;
let prisma: PrismaClient | null = null;

const EXPECTED_TEST_DB = "instapro_test";
const DEFAULT_TEST_PORT = 5433;

function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Safety Violation: TEST_DATABASE_URL environment variable is required for tests. Refusing to fall back to DATABASE_URL."
    );
  }

  // Parse URL to verify target database name
  try {
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, "");
    if (dbName !== EXPECTED_TEST_DB) {
      throw new Error(
        `Safety Violation: TEST_DATABASE_URL must target database '${EXPECTED_TEST_DB}'. Received: '${dbName}'`
      );
    }
  } catch (err: any) {
    if (err.message.includes("Safety Violation")) throw err;
    throw new Error(`Invalid TEST_DATABASE_URL format: ${url}`);
  }

  return url;
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

async function applyMigrationsToTestDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Assert again via direct database query
    const dbCheck = await client.query("SELECT current_database();");
    const currentDb = dbCheck.rows[0]?.current_database;
    if (currentDb !== EXPECTED_TEST_DB) {
      throw new Error(
        `Safety Violation: Migration target is '${currentDb}', but expected '${EXPECTED_TEST_DB}'. Aborting.`
      );
    }

    // Ensure _prisma_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum"              VARCHAR(64) NOT NULL,
        "finished_at"           TIMESTAMPTZ,
        "migration_name"        VARCHAR(255) NOT NULL,
        "logs"                  TEXT,
        "rolled_back_at"        TIMESTAMPTZ,
        "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
      );
    `);

    const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
    const migrationFolders = fs
      .readdirSync(migrationsDir)
      .filter((file) => fs.statSync(path.join(migrationsDir, file)).isDirectory())
      .sort();

    for (const folder of migrationFolders) {
      const existing = await client.query(
        `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL;`,
        [folder]
      );

      if (existing.rows.length === 0) {
        const sqlPath = path.join(migrationsDir, folder, "migration.sql");
        if (fs.existsSync(sqlPath)) {
          const sql = fs.readFileSync(sqlPath, "utf-8");
          console.log(`[Test DB] Applying migration: ${folder}...`);
          await client.query(sql);

          const crypto = await import("crypto");
          const migrationId = crypto.randomUUID();
          const checksum = crypto.createHash("sha256").update(sql).digest("hex");

          await client.query(
            `INSERT INTO "_prisma_migrations" (
              "id", "checksum", "finished_at", "migration_name", "applied_steps_count"
            ) VALUES ($1, $2, now(), $3, 1)
            ON CONFLICT ("id") DO NOTHING;`,
            [migrationId, checksum, folder]
          );
        }
      }
    }
  } finally {
    await client.end();
  }
}

export async function getTestPrisma(): Promise<PrismaClient> {
  if (prisma) return prisma;

  const testUrl = getTestDatabaseUrl();
  const parsedUrl = new URL(testUrl);
  const testPort = parseInt(parsedUrl.port || String(DEFAULT_TEST_PORT), 10);
  const testHost = parsedUrl.hostname || "127.0.0.1";

  const isOpen = await isPortOpen(testPort, testHost);

  if (!isOpen) {
    console.log(`[Test DB] Starting isolated embedded PostgreSQL on port ${testPort}...`);
    const testDataDir = path.resolve(process.cwd(), ".local-test-db-data");

    embeddedTestPgInstance = new (EmbeddedPostgres as any)({
      databaseDir: testDataDir,
      port: testPort,
      user: "postgres",
      password: "postgres",
      initialDatabase: "postgres",
    });

    if (!fs.existsSync(testDataDir)) {
      await embeddedTestPgInstance.initialise();
    }
    await embeddedTestPgInstance.start();
  }

  // Ensure instapro_test database exists
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

  // Apply all migrations to the isolated test database
  await applyMigrationsToTestDatabase(testUrl);

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: testUrl,
      },
    },
  });

  // Verify connected database name via Prisma raw query
  const check = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>(
    "SELECT current_database();"
  );
  const connectedDb = check[0]?.current_database;
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

  // Safety Assertion: Never truncate if current_database is not instapro_test
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
  if (embeddedTestPgInstance) {
    await new Promise((r) => setTimeout(r, 200));
    await embeddedTestPgInstance.stop();
    embeddedTestPgInstance = null;
  }
}
