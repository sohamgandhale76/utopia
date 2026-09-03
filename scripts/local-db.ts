import EmbeddedPostgres from "embedded-postgres";
import path from "path";
import fs from "fs";

async function main() {
  const dataDir = path.resolve(process.cwd(), ".local-db-data");
  const port = 5432;
  const pg = new (EmbeddedPostgres as any)({
    databaseDir: dataDir,
    port: port,
    user: "postgres",
    password: "postgres",
    initialDatabase: "instapro",
  });

  if (!fs.existsSync(dataDir)) {
    console.log("Initialising PostgreSQL data cluster...");
    await pg.initialise();
  }

  console.log(`Starting local PostgreSQL on port ${port}...`);
  await pg.start();
  console.log(`Local PostgreSQL is running at postgresql://postgres:postgres@localhost:${port}/instapro`);

  const shutdown = async () => {
    console.log("Stopping local PostgreSQL...");
    await pg.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Failed to start local database:", err);
  process.exit(1);
});
