import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTestDatabaseUrl } from "../helpers/test-db";

describe("Test Database Isolation Guard Tests (Unit & Contract)", () => {
  const originalTestDbUrl = process.env.TEST_DATABASE_URL;
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.TEST_DATABASE_URL = originalTestDbUrl;
    process.env.DATABASE_URL = originalDbUrl;
  });

  it("throws when TEST_DATABASE_URL is missing", () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => getTestDatabaseUrl()).toThrow(
      /Safety Violation: TEST_DATABASE_URL environment variable is required for tests/
    );
  });

  it("never uses DATABASE_URL as fallback when TEST_DATABASE_URL is missing", () => {
    delete process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/instapro?schema=public";

    expect(() => getTestDatabaseUrl()).toThrow(
      /Refusing to fall back to DATABASE_URL/
    );
  });

  it("throws when TEST_DATABASE_URL targets the development database 'instapro'", () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/instapro?schema=public";

    expect(() => getTestDatabaseUrl()).toThrow(
      /Safety Violation: TEST_DATABASE_URL targets the development database 'instapro'/
    );
  });

  it("throws when TEST_DATABASE_URL targets any non-instapro_test database", () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5433/other_db?schema=public";

    expect(() => getTestDatabaseUrl()).toThrow(
      /Safety Violation: TEST_DATABASE_URL must target database 'instapro_test'\. Received: 'other_db'/
    );
  });

  it("accepts and returns TEST_DATABASE_URL when it strictly targets 'instapro_test'", () => {
    const validUrl =
      "postgresql://postgres:postgres@localhost:5433/instapro_test?schema=public";
    process.env.TEST_DATABASE_URL = validUrl;

    expect(getTestDatabaseUrl()).toBe(validUrl);
  });
});
