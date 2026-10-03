import 'server-only';
import { headers } from 'next/headers';
import type { AuditAction, Role } from './domain';
import { prisma } from './prisma';
import { hashIp } from './crypto';

/**
 * AUDIT LOGGING
 *
 * Records security-relevant actions. Deliberate constraints:
 * - Audit failures never break the request they describe; they are logged to
 *   stderr instead.
 * - `metadata` is a JSON string supplied by the caller. Callers must only pass
 *   non-sensitive operational facts (ids, counts, previous values) - never
 *   passwords, tokens, card data or full addresses.
 */

export type AuditInput = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  actorRole?: Role | null;
  metadata?: Record<string, string | number | boolean | null>;
};

async function requestContext(): Promise<{ ipHash?: string; userAgent?: string }> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]?.trim() : h.get('x-real-ip');
  return {
    ipHash: ip ? hashIp(ip) : undefined,
    userAgent: h.get('user-agent')?.slice(0, 255) || undefined,
  };
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const ctx = await requestContext();
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        ipHash: ctx.ipHash ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  } catch (err) {
    // Never surface audit internals to the client.
    console.error('[audit] failed to record event', {
      action: input.action,
      entityType: input.entityType,
      err: err instanceof Error ? err.message : 'unknown',
    });
  }
}