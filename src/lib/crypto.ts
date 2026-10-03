import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from './env';

/**
 * CRYPTOGRAPHY HELPERS
 *
 * - Passwords: bcrypt with cost 12 (slow, salted). Never reversible, never logged.
 * - Session tokens: 256 bits of CSPRNG entropy, stored only as SHA-256 hashes.
 * - Timing-safe comparison everywhere a secret is compared.
 */

/** bcrypt cost. 12 is a deliberate CPU/latency balance for interactive logins. */
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    // A malformed hash must not throw a 500 that reveals internals.
    return false;
  }
}

/** URL-safe random token, used as the raw session cookie value. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Used for session tokens, IPs and idempotency keys. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * HMAC used to bind a token to the app secret (domain separation for cookies).
 * Does not replace server-side session storage; it makes a stolen DB dump alone
 * insufficient to forge a cookie.
 */
export function hmac(value: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(value, 'utf8').digest('base64url');
}

/** Constant-time string comparison that tolerates length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length isn't a timing oracle.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * One-way, salted hash of an IP address for rate limiting and audit logs.
 * Raw IPs are deliberately never persisted, which keeps the audit log from
 * becoming a location tracker of users.
 */
export function hashIp(ip: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(`ip:${ip}`, 'utf8').digest('hex').slice(0, 32);
}

/** Timing-equal dummy hash used to absorb timing differences on unknown users. */
export const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1s2w2w2w2w2w2w2w2w2w2w2w2w2w2w2';