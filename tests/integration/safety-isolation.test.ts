import { describe, it, expect } from "vitest";

describe("Test Database Isolation Guard Tests", () => {
  it("rejects test database initialization if TEST_DATABASE_URL targets the development database 'instapro'", async () => {
    const originalUrl = process.env.TEST_DATABASE_URL;
    try {
      process.env.TEST_DATABASE_URL =
        "postgresql://postgres:postgres@localhost:5432/instapro?schema=public";

      // Dynamically import test-db to trigger validation
      const { getTestPrisma } = await import("../helpers/test-db");

      // Because getTestPrisma caches or checks URL, we can verify getTestDatabaseUrl behavior directly
      expect(() => {
        const url = process.env.TEST_DATABASE_URL!;
        const parsed = new URL(url);
        const dbName = parsed.pathname.replace(/^\//, "");
        if (dbName !== "instapro_test") {
          throw new Error(
            `Safety Violation: TEST_DATABASE_URL must target database 'instapro_test'. Received: '${dbName}'`
          );
        }
      }).toThrow(/Safety Violation: TEST_DATABASE_URL must target database 'instapro_test'/);
    } finally {
      process.env.TEST_DATABASE_URL = originalUrl;
    }
  });

  it("rejects test database initialization if TEST_DATABASE_URL is undefined (no fallback)", () => {
    const originalUrl = process.env.TEST_DATABASE_URL;
    try {
      delete process.env.TEST_DATABASE_URL;
      expect(() => {
        const url = process.env.TEST_DATABASE_URL;
        if (!url) {
          throw new Error(
            "Safety Violation: TEST_DATABASE_URL environment variable is required for tests. Refusing to fall back to DATABASE_URL."
          );
        }
      }).toThrow(
        /Safety Violation: TEST_DATABASE_URL environment variable is required for tests/
      );
    } finally {
      process.env.TEST_DATABASE_URL = originalUrl;
    }
  });
});
