import 'server-only';
import { headers } from 'next/headers';
import { hashIp } from './crypto';

/**
 * RATE LIMITING (in-memory, fixed window)
 *
 * Protects authentication endpoints against brute force and credential
 * stuffing, and expensive endpoints against abuse.
 *
 * LIMITATION - DOCUMENTED DELIBERATELY:
 * This store is per-process. With multiple instances, each enforces its own
 * quota, so the effective limit multiplies by instance count. For horizontal
 * scaling you MUST replace the `store` implementation with Redis. See
 * SECURITY.md -> "Remaining production requirements".
 */

type Bucket = { count: number; resetAt: number };

const globalForLimiter = globalThis as unknown as { __moyoLimiter?: Map<string, Bucket> };
const store: Map<string, Bucket> = (globalForLimiter.__moyoLimiter ??= new Map());

/** Prevents unbounded memory growth from attacker-supplied keys. */
const MAX_TRACKED_KEYS = 20_000;

function sweep(now: number) {
  if (store.size < MAX_TRACKED_KEYS) return;
  for (const [k, b] of store) {
    if (b.resetAt <= now) store.delete(k);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitRule = {
  /** Unique name for this limiter, used as a key prefix. */
  name: string;
  limit: number;
  windowMs: number;
};

export async function rateLimit(
  rule: RateLimitRule,
  identifier: string,
): Promise<RateLimitResult> {
  const now = Date.now();
  sweep(now);

  const key = `${rule.name}:${identifier}`;
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;

  if (bucket.count > rule.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  return { allowed: true, remaining: rule.limit - bucket.count, retryAfterSeconds: 0 };
}

/** Rate limit keyed by hashed client IP. Raw IPs are never stored. */
export async function rateLimitByIp(rule: RateLimitRule): Promise<RateLimitResult> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  const ip = fwd ? (fwd.split(',')[0]?.trim() ?? 'unknown') : (h.get('x-real-ip') ?? 'unknown');
  return rateLimit(rule, hashIp(ip));
}

/** Rate limit keyed by a stable user identifier (e.g. account id). */
export async function rateLimitByUser(rule: RateLimitRule, userId: string) {
  return rateLimit(rule, `u:${userId}`);
}

// --- Predefined policies -----------------------------------------------------

/** Login: tight, IP-keyed, to blunt online password guessing. */
export const LOGIN_POLICY: RateLimitRule = { name: 'login', limit: 8, windowMs: 15 * 60_000 };

/** Registration: limits mass account creation. */
export const REGISTER_POLICY: RateLimitRule = { name: 'register', limit: 5, windowMs: 60 * 60_000 };

/** Booking creation: prevents accidental or malicious flooding. */
export const BOOKING_POLICY: RateLimitRule = { name: 'booking', limit: 10, windowMs: 60 * 60_000 };

/** Uploads: small quota because each consumes disk. */
export const UPLOAD_POLICY: RateLimitRule = { name: 'upload', limit: 10, windowMs: 60 * 60_000 };

/** Support messages. */
export const MESSAGE_POLICY: RateLimitRule = { name: 'message', limit: 10, windowMs: 60 * 60_000 };

/** Reviews. */
export const REVIEW_POLICY: RateLimitRule = { name: 'review', limit: 5, windowMs: 60 * 60_000 };

/** Generic mutation guard for admin APIs. */
export const ADMIN_MUTATION_POLICY: RateLimitRule = { name: 'admin', limit: 120, windowMs: 60_000 };

/**
 * Authenticated reads (booking list / detail).
 *
 * Generous, because these back ordinary page navigation, but still bounded so
 * that a compromised or scripted session cannot enumerate records in a loop.
 */
export const READ_POLICY: RateLimitRule = { name: 'read', limit: 120, windowMs: 60_000 };

/**
 * Price preview requests.
 *
 * Each one performs a database read and is issued once per wizard step, so the
 * quota is sized for that flow rather than for free-form querying.
 */
export const QUOTE_POLICY: RateLimitRule = { name: 'quote', limit: 30, windowMs: 60_000 };

/** Webhook endpoint: providers retry, so the limit is generous. */
export const WEBHOOK_POLICY: RateLimitRule = { name: 'webhook', limit: 120, windowMs: 60_000 };