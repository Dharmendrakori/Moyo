import 'server-only';
import { cache } from 'react';
import { prisma } from './prisma';
import { audit } from './audit';
import { ApiError } from './api';

/**
 * TECHNICIAN FEATURE CONFIGURATION
 *
 * Two independently configurable capabilities:
 *
 *   adminManagementEnabled  the roster screens and their write APIs
 *   portalEnabled           technician sign-in and the /technician portal
 *
 * WHY A DEDICATED TYPED MODEL INSTEAD OF the generic `Setting` key/value table:
 * a key/value store lets any caller invent a key and stores every value as text,
 * so "false", "0" and "off" all become a truthiness question at the point where
 * an authentication decision is made. This model has exactly two boolean columns
 * and one row, so the set of knobs is closed and a stored value cannot be
 * ambiguous.
 *
 * FAIL-SAFE DIRECTION: every path that cannot produce a trustworthy answer -
 * no row yet, a database error, an unexpected shape - returns the DEFAULTS
 * (admin management ON, portal OFF). A configuration read failure can therefore
 * never enable technician authentication.
 */

export type TechnicianFeatures = {
  adminManagementEnabled: boolean;
  portalEnabled: boolean;
};

/** Initial defaults, also what an absent row or a failed read yields. */
export const DEFAULT_TECHNICIAN_FEATURES: TechnicianFeatures = {
  adminManagementEnabled: true,
  portalEnabled: false,
};

/** The configuration is a single row, addressed by this literal key. */
export const TECHNICIAN_FEATURES_ID = 'singleton';

const SELECT = { adminManagementEnabled: true, portalEnabled: true } as const;

/**
 * Reads the current configuration.
 *
 * Memoised per request (`cache`) so a page with several server components and a
 * route handler do not each pay for the same row; the next request always sees
 * a committed change, which is what makes a flag flip take effect immediately
 * without a redeploy.
 */
export const getTechnicianFeatures = cache(async (): Promise<TechnicianFeatures> => {
  try {
    const row = await prisma.technicianFeatureConfig.findUnique({
      where: { id: TECHNICIAN_FEATURES_ID },
      select: SELECT,
    });
    if (!row) return DEFAULT_TECHNICIAN_FEATURES;
    // Narrow explicitly: the columns are booleans, but a stale or hand-edited
    // row must never be able to enable the portal merely by being truthy.
    return {
      adminManagementEnabled: row.adminManagementEnabled === true,
      portalEnabled: row.portalEnabled === true,
    };
  } catch (err) {
    console.error('[technician-features] configuration read failed; using safe defaults', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    return DEFAULT_TECHNICIAN_FEATURES;
  }
});

/**
 * Rejects a management mutation while the capability is switched off.
 *
 * This is the server-side enforcement behind the disabled UI: hiding a button is
 * a courtesy, not a control. It is deliberately NOT applied to dispatch reads,
 * so turning the roster screens off can never stop an operator assigning a
 * technician to a confirmed booking.
 */
export async function assertTechnicianAdminManagementEnabled(): Promise<void> {
  const features = await getTechnicianFeatures();
  if (!features.adminManagementEnabled) {
    throw new ApiError(
      'ADMIN_MANAGEMENT_DISABLED',
      'Technician management is switched off in the platform configuration. Existing technicians and assignments are unaffected.',
      403,
    );
  }
}

/**
 * Revokes every live session belonging to a TECHNICIAN account.
 *
 * Used when the portal is switched off or a technician is deactivated: sessions
 * are database rows, so revoking them takes effect on the very next request -
 * there is no token that can outlive the decision. Returns how many were
 * revoked, which the caller audits.
 */
export async function revokeTechnicianPortalSessions(): Promise<number> {
  const technicians = await prisma.user.findMany({
    where: { role: 'TECHNICIAN' },
    select: { id: true },
  });
  if (technicians.length === 0) return 0;

  const result = await prisma.session.updateMany({
    where: { userId: { in: technicians.map((t) => t.id) }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export type TechnicianFeaturesChange = {
  previous: TechnicianFeatures;
  current: TechnicianFeatures;
  revokedSessions: number;
};

/**
 * Applies a partial configuration change.
 *
 * The previous values are read from the database (not from the caller) so the
 * audit record names what actually changed. Switching the portal off revokes
 * live technician sessions in the same operation - a flag flip is an access
 * revocation, not merely a hidden link. Nothing here deletes a technician, an
 * account, an assignment or any booking.
 */
export async function setTechnicianFeatures(
  input: Partial<TechnicianFeatures>,
  actor: { id: string; role: 'ADMIN' },
): Promise<TechnicianFeaturesChange> {
  const before = await prisma.technicianFeatureConfig.findUnique({
    where: { id: TECHNICIAN_FEATURES_ID },
    select: SELECT,
  });
  const previous: TechnicianFeatures = before
    ? {
        adminManagementEnabled: before.adminManagementEnabled === true,
        portalEnabled: before.portalEnabled === true,
      }
    : DEFAULT_TECHNICIAN_FEATURES;

  const row = await prisma.technicianFeatureConfig.upsert({
    where: { id: TECHNICIAN_FEATURES_ID },
    create: { id: TECHNICIAN_FEATURES_ID, ...previous, ...input },
    update: { ...input },
    select: SELECT,
  });

  const current: TechnicianFeatures = {
    adminManagementEnabled: row.adminManagementEnabled === true,
    portalEnabled: row.portalEnabled === true,
  };

  // Turning the portal off invalidates sessions minted while it was on.
  const revokedSessions =
    previous.portalEnabled && !current.portalEnabled ? await revokeTechnicianPortalSessions() : 0;

  await audit({
    action: 'TECHNICIAN_FEATURES_CHANGED',
    entityType: 'TechnicianFeatureConfig',
    entityId: TECHNICIAN_FEATURES_ID,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      previousAdminManagementEnabled: previous.adminManagementEnabled,
      adminManagementEnabled: current.adminManagementEnabled,
      previousPortalEnabled: previous.portalEnabled,
      portalEnabled: current.portalEnabled,
      revokedSessions,
    },
  });

  return { previous, current, revokedSessions };
}

