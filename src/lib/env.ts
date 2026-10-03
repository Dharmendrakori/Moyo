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
  PAYMENT_PROVIDER: z.string().default(''),
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),
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
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET,
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
 * Payment provider readiness. When unconfigured, payment endpoints must return
 * 503 instead of simulating a successful charge.
 */
export function isPaymentConfigured(): boolean {
  const e = env();
  return Boolean(e.PAYMENT_PROVIDER && e.PAYMENT_WEBHOOK_SECRET);
}