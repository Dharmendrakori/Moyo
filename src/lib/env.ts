import 'server-only';
import { z } from 'zod';

/**
 * Environment validation.
 *
 * Fails FAST at boot if production secrets are missing, rather than silently
 * running with a default. Nothing here ever returns a secret to the client.
 */

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  /**
   * Razorpay credentials. Server-only: `RAZORPAY_KEY_ID` is the publishable half
   * and is the ONLY one ever sent to the browser; the secret and webhook secret
   * must never leave the server.
   */
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  RATE_LIMIT_STORE: z.string().default('memory'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(25).default(5),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function load(): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    APP_URL: process.env.APP_URL,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    // Deliberately does NOT print env values, only variable names.
    throw new Error(`Invalid server environment configuration -> ${issues}`);
  }

  if (parsed.data.NODE_ENV === 'production' && parsed.data.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }

  return parsed.data;
}

let cached: ServerEnv | undefined;

/** Server-only env accessor. Never import this from a client component. */
export function env(): ServerEnv {
  cached ??= load();
  return cached;
}

export const isProd = () => env().NODE_ENV === 'production';

/**
 * Payment provider readiness.
 *
 * When the gateway credentials are absent, every payment endpoint must fail
 * safely (503) instead of simulating a charge. Nothing in this application ever
 * pretends a payment happened.
 */
export function isPaymentConfigured(): boolean {
  const e = env();
  return Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET);
}

/**
 * The publishable key handed to the browser at checkout.
 *
 * Only `RAZORPAY_KEY_ID` is safe to expose - it identifies the account, it does
 * not authorise anything. The secret and webhook secret are never returned by
 * any function in this module outside the server-only gateway client.
 */
export function razorpayPublicKey(): string {
  return env().RAZORPAY_KEY_ID;
}
