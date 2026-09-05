/**
 * In-process authentication rate limiting and resource-exhaustion protection.
 *
 * SEC-01 Remediation:
 * - Bounded in-memory IP burst guard (5 req / 10s / IP) with LRU eviction.
 * - Argon2id concurrency circuit breaker (max 4 concurrent verifications, zero unbounded queue).
 * - Per-(IP, username) failure throttling to prevent credential guessing without account lockout.
 * - Safe client IP extraction with explicit reverse-proxy trust boundary.
 */

export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Bounded Map with Least-Recently-Used (LRU) eviction and per-entry expiration.
 * Prevents memory exhaustion attacks by strictly capping the maximum number of stored keys.
 */
export class BoundedMap<K, V> {
  private readonly maxEntries: number;
  private readonly map: Map<K, CacheEntry<V>>;

  constructor(maxEntries: number = 10_000) {
    if (maxEntries <= 0) {
      throw new Error("maxEntries must be greater than 0");
    }
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key: K, now: number = Date.now()): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh LRU order: delete and re-insert at tail
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number, now: number = Date.now()): void {
    const expiresAt = now + ttlMs;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict oldest (least recently used) entry
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, { value, expiresAt });
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  has(key: K, now: number = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  get size(): number {
    return this.map.size;
  }

  get capacity(): number {
    return this.maxEntries;
  }

  clear(): void {
    this.map.clear();
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  remaining?: number;
}

/**
 * Sliding-window burst limiter per IP address.
 * Bounded to maxEntries (default 10,000) to prevent memory exhaustion.
 */
export class IpBurstLimiter {
  private readonly store: BoundedMap<string, number[]>;
  readonly maxRequests: number;
  readonly windowMs: number;

  constructor(
    maxRequests: number = 5,
    windowMs: number = 10_000,
    maxEntries: number = 10_000
  ) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.store = new BoundedMap<string, number[]>(maxEntries);
  }

  consume(ip: string, now: number = Date.now()): RateLimitResult {
    const existing = this.store.get(ip, now) ?? [];
    const validTimestamps = existing.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      const oldest = validTimestamps[0];
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      this.store.set(ip, validTimestamps, this.windowMs, now);
      return {
        allowed: false,
        retryAfterMs,
        remaining: 0,
      };
    }

    validTimestamps.push(now);
    this.store.set(ip, validTimestamps, this.windowMs, now);

    return {
      allowed: true,
      remaining: this.maxRequests - validTimestamps.length,
    };
  }

  reset(ip: string): void {
    this.store.delete(ip);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Circuit breaker capping concurrent Argon2/bcrypt verification operations.
 * Rejects requests immediately when all slots are occupied to avoid unbounded memory/queue growth.
 */
export class ConcurrencyLimiter {
  readonly maxConcurrency: number;
  private activeCount: number = 0;

  constructor(maxConcurrency: number = 4) {
    if (maxConcurrency <= 0) {
      throw new Error("maxConcurrency must be greater than 0");
    }
    this.maxConcurrency = maxConcurrency;
  }

  tryAcquire(): boolean {
    if (this.activeCount >= this.maxConcurrency) {
      return false;
    }
    this.activeCount++;
    return true;
  }

  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  reset(): void {
    this.activeCount = 0;
  }
}

/**
 * Per-(IP, username) failure limiter.
 * Throttles targeted credential attacks from a specific IP against a specific username.
 * NEVER locks the username globally across all IPs, avoiding account-lockout DoS.
 */
export class PerIpUsernameFailureLimiter {
  private readonly store: BoundedMap<string, number>;
  readonly maxFailures: number;
  readonly windowMs: number;

  constructor(
    maxFailures: number = 5,
    windowMs: number = 15 * 60 * 1000, // 15 minutes
    maxEntries: number = 10_000
  ) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.store = new BoundedMap<string, number>(maxEntries);
  }

  private makeKey(ip: string, username: string): string {
    return `${ip}:${username.toLowerCase()}`;
  }

  isBlocked(ip: string, username: string, now: number = Date.now()): boolean {
    const key = this.makeKey(ip, username);
    const failures = this.store.get(key, now);
    if (failures === undefined) return false;
    return failures >= this.maxFailures;
  }

  recordFailure(ip: string, username: string, now: number = Date.now()): void {
    const key = this.makeKey(ip, username);
    const existing = this.store.get(key, now) ?? 0;
    this.store.set(key, existing + 1, this.windowMs, now);
  }

  clearFailure(ip: string, username: string): void {
    const key = this.makeKey(ip, username);
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export interface HeaderGetter {
  get(name: string): string | null;
}

/**
 * Safely extracts client IP address only when an explicit trusted reverse-proxy
 * configuration is present.
 *
 * Security Rationale:
 * Next.js does not expose raw TCP socket addresses in Server Actions.
 * In environments without a verified reverse proxy, client-supplied headers
 * (e.g. X-Forwarded-For, X-Real-IP) can be arbitrarily forged.
 * Trusting them blindly allows attackers to bypass IP limits by rotating headers
 * or poison another client's IP quota.
 *
 * Configuration:
 * - Set TRUST_PROXY=true (or 1) when deployed behind a trusted edge/proxy.
 * - Optionally set TRUSTED_PROXY_HEADER (e.g., "cf-connecting-ip", "x-real-ip").
 */
export function getClientIp(headers: HeaderGetter): string | null {
  const trustProxy =
    process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1";

  if (!trustProxy) {
    return null;
  }

  const configuredHeader = process.env.TRUSTED_PROXY_HEADER?.toLowerCase();
  if (configuredHeader) {
    const val = headers.get(configuredHeader);
    if (val) {
      const ip = val.split(",")[0]?.trim();
      if (ip) return ip;
    }
  }

  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = forwardedFor.split(",")[0]?.trim();
    if (ip) return ip;
  }

  return null;
}

// Singletons for application-level authentication protection
export const ipBurstLimiter = new IpBurstLimiter(5, 10_000, 10_000);
export const argon2CircuitBreaker = new ConcurrencyLimiter(4);
export const ipUserFailureLimiter = new PerIpUsernameFailureLimiter(
  5,
  15 * 60 * 1000,
  10_000
);
