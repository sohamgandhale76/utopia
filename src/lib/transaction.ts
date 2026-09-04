import { Prisma } from "@prisma/client";

export interface RetryOptions {
  maxRetries?: number;
  backoff?: boolean;
}

/**
 * Executes an operation with bounded retries for serialization failures (P2034)
 * and PostgreSQL write conflicts.
 *
 * @param operation The async database operation to execute.
 * @param maxRetriesOrOptions Number of retries or a RetryOptions configuration object.
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetriesOrOptions: number | RetryOptions = 3
): Promise<T> {
  const maxRetries =
    typeof maxRetriesOrOptions === "number"
      ? maxRetriesOrOptions
      : (maxRetriesOrOptions.maxRetries ?? 3);
  const useBackoff =
    typeof maxRetriesOrOptions === "object"
      ? (maxRetriesOrOptions.backoff ?? false)
      : false;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      const isRetryable =
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034") ||
        (error instanceof Error && error.message.includes("write conflict"));

      if (isRetryable && attempt < maxRetries) {
        if (useBackoff) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.floor(Math.random() * 40) + 10)
          );
        }
        continue;
      }
      throw error;
    }
  }
}
