import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { executeWithRetry } from "@/lib/transaction";

function serializationError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock",
    { code: "P2034", clientVersion: "test" }
  );
}

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("Shared transaction retry helper (src/lib/transaction)", () => {
  it("returns the result immediately on first success", async () => {
    let attempts = 0;
    const result = await executeWithRetry(async () => {
      attempts++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  it("retries P2034 serialization failures until success", async () => {
    let attempts = 0;
    const result = await executeWithRetry(async () => {
      attempts++;
      if (attempts < 3) throw serializationError();
      return attempts;
    });
    expect(result).toBe(3);
  });

  it("retries raw 'write conflict' driver errors until success", async () => {
    let attempts = 0;
    const result = await executeWithRetry(async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error("canceling statement due to write conflict");
      }
      return "recovered";
    });
    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("does not retry non-retryable errors and rethrows them as-is", async () => {
    let attempts = 0;
    await expect(
      executeWithRetry(async () => {
        attempts++;
        throw uniqueConstraintError();
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(attempts).toBe(1);
  });

  it("gives up after maxRetries and rethrows the final retryable error", async () => {
    let attempts = 0;
    await expect(
      executeWithRetry(
        async () => {
          attempts++;
          throw serializationError();
        },
        3
      )
    ).rejects.toThrow();
    expect(attempts).toBe(3);
  });

  it("accepts the RetryOptions object form, including backoff", async () => {
    let attempts = 0;
    const result = await executeWithRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw serializationError();
        return "recovered-with-backoff";
      },
      { maxRetries: 2, backoff: true }
    );
    expect(result).toBe("recovered-with-backoff");
    expect(attempts).toBe(2);
  });
});
