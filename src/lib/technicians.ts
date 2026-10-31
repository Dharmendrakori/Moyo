import 'server-only';
import { prisma } from './prisma';
import { audit } from './audit';
import { ApiError, notFound } from './api';
import { DUMMY_HASH, generateToken, sha256 } from './crypto';
import type { adminTechnicianQuerySchema } from './validation';
import type { z } from 'zod';

/**
 * TECHNICIAN ROSTER AND ACCOUNT PROVISIONING
 *
 * Same rules as `admin-catalog.ts`, applied to people:
 *
 * 1. MINIMISATION. Every query names its columns. No password hash, session
 *    token, IP hash or unrelated personal column is fetched, so none can reach a
 *    page or an API response.
 * 2. THE ROW IS THE AUTHORITY. The record is re-read by primary key before a
 *    write; the browser's idea of the current value is never trusted.
 * 3. NOTHING PRIVILEGED IS ACCEPTED. `role`, `userId`, `providerId`,
 *    `passwordHash` and the rating aggregates are absent from every schema.
 * 4. AUTHORISATION IS THE CALLER'S JOB. These functions assume the route guard and
 *    the admin-management feature check have already run.
 *
 * ACCOUNT INVARIANT (deliberate, and why there is no separate "disable login"
 * control): a technician can use the portal only when the portal feature is on AND
 * the profile is active AND the linked login is active. Deactivating a profile
 * therefore disables its login and revokes its live sessions in one step, so
 * "active profile, unusable account" cannot exist as a confusing state.
 */

/** Shape returned to the console. Never contains credential material. */
export type TechnicianRow = {
  id: string;
  providerId: string;
  displayName: string;
  headline: string | null;
  skills: string | null;
  serviceAreas: string | null;
  phone: string | null;
  isActive: boolean;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
  account: { id: string; email: string; isActive: boolean; activationPending: boolean } | null;
  /** Why this technician can or cannot receive a new assignment right now. */
  eligibility: 'ASSIGNABLE' | 'INACTIVE' | 'UNAVAILABLE';
};

const PROFILE_SELECT = {
  id: true,
  providerId: true,
  displayName: true,
  headline: true,
  skills: true,
  serviceAreas: true,
  phone: true,
  isActive: true,
  isAvailable: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, isActive: true, activationExpiresAt: true } },
} as const;

type RawProfile = {
  id: string;
  providerId: string;
  displayName: string;
  headline: string | null;
  skills: string | null;
  serviceAreas: string | null;
  phone: string | null;
  isActive: boolean;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; email: string; isActive: boolean; activationExpiresAt: Date | null } | null;
};

function toRow(row: RawProfile): TechnicianRow {
  return {
    id: row.id,
    providerId: row.providerId,
    displayName: row.displayName,
    headline: row.headline,
    skills: row.skills,
    serviceAreas: row.serviceAreas,
    phone: row.phone,
    isActive: row.isActive,
    isAvailable: row.isAvailable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    account: row.user
      ? {
          id: row.user.id,
          email: row.user.email,
          isActive: row.user.isActive,
          // The hash is never selected; a live expiry means "invited, not yet
          // activated".
          activationPending: row.user.activationExpiresAt !== null,
        }
      : null,
    eligibility: !row.isActive ? 'INACTIVE' : row.isAvailable ? 'ASSIGNABLE' : 'UNAVAILABLE',
  };
}

export type TechnicianQuery = z.infer<typeof adminTechnicianQuerySchema>;

/** Roster page: search, active/availability filters, server-side paging. */
export async function listTechnicians(query: TechnicianQuery): Promise<{
  items: TechnicianRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const where: Record<string, unknown> = {};
  if (query.q) {
    // Substring search over operator-facing fields only - not the login email,
    // which browsing the roster does not require.
    where.OR = [
      { displayName: { contains: query.q } },
      { skills: { contains: query.q } },
      { serviceAreas: { contains: query.q } },
      { phone: { contains: query.q } },
    ];
  }
  if (query.status !== 'ALL') where.isActive = query.status === 'ACTIVE';
  if (query.availability !== 'ALL') where.isAvailable = query.availability === 'AVAILABLE';

  const [rows, total] = await Promise.all([
    prisma.technician.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: PROFILE_SELECT,
    }),
    prisma.technician.count({ where }),
  ]);

  return {
    items: (rows as RawProfile[]).map(toRow),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * One roster row, re-read after a write so the response reflects the committed
 * record rather than the request body.
 */
export async function getTechnicianRow(id: string): Promise<TechnicianRow | null> {
  const row = await prisma.technician.findUnique({ where: { id }, select: PROFILE_SELECT });
  return row ? toRow(row as RawProfile) : null;
}

/**
 * Technician profiles belong to a provider. This deployment has exactly one
 * active provider, and assignment binds a technician to the booking's provider -
 * so creating a profile under the wrong one would produce a technician who can
 * never be assigned. Rather than guess, the roster refuses to create anything
 * until that is unambiguous.
 */
export async function resolveDefaultProviderId(): Promise<string> {
  const providers = await prisma.provider.findMany({
    where: { isActive: true },
    select: { id: true },
    take: 2,
  });
  const [only] = providers;
  if (providers.length !== 1 || !only) {
    throw new ApiError(
      'PROVIDER_NOT_RESOLVED',
      'Technician profiles are created under the active service provider, and this platform does not currently have exactly one active provider.',
      409,
    );
  }
  return only.id;
}

/**
 * THE ASSIGNMENT ELIGIBILITY RULE, in one place.
 *
 * Existence, provider membership, activation and availability are checked here so
 * the dedicated assign endpoint and the generic transition endpoint cannot
 * disagree. `isAvailable` is enforced deliberately: an operator who has marked
 * someone unavailable should not be able to dispatch work to them by picking them
 * from a list.
 */
export async function assertAssignableTechnician(
  technicianId: string,
  providerId: string | null,
): Promise<{ id: string; displayName: string }> {
  const technician = await prisma.technician.findFirst({
    where: { id: technicianId, ...(providerId ? { providerId } : {}) },
    select: { id: true, displayName: true, isActive: true, isAvailable: true },
  });

  if (!technician) {
    throw new ApiError(
      'INVALID_TECHNICIAN',
      "That technician does not exist for this booking's provider.",
      422,
    );
  }
  if (!technician.isActive) {
    throw new ApiError(
      'TECHNICIAN_INACTIVE',
      'That technician is deactivated and cannot be assigned to new work.',
      422,
    );
  }
  if (!technician.isAvailable) {
    throw new ApiError(
      'TECHNICIAN_UNAVAILABLE',
      'That technician is marked unavailable. Mark them available on the technician roster before assigning work.',
      422,
    );
  }

  return { id: technician.id, displayName: technician.displayName };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** An invitation is valid for this long; re-issuing replaces it. */
export const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Prisma's unique-constraint code. */
const isUniqueViolation = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === 'P2002';

const emptyToNull = (value: string | undefined): string | null =>
  value && value.trim() ? value.trim() : null;

/**
 * The one-time activation link handed to the operator, who passes it to the
 * technician out of band. It is returned EXACTLY ONCE, at provisioning time: only
 * its SHA-256 hash is stored, so it cannot be re-read from the database or from a
 * later response.
 *
 * The token travels as a PATH segment, not a query parameter. The edge proxy strips
 * credential-bearing query parameters (`?token=…`) from every GET URL, so a query
 * string would be scrubbed before the page could read it; a path segment survives
 * that scrub, is not sent to third parties (the Referrer policy sends the origin
 * only cross-origin), and is never logged by this application. It is single-use,
 * expires, and is worthless once used.
 */
export function activationPathFor(token: string): string {
  return `/technician/activate/${encodeURIComponent(token)}`;
}

/** Revokes one account's live sessions. Used when a technician is deactivated. */
async function revokeUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export type CreateTechnicianInput = {
  displayName: string;
  headline?: string | undefined;
  skills?: string | undefined;
  serviceAreas?: string | undefined;
  phone?: string | undefined;
  isActive: boolean;
  isAvailable: boolean;
  accountEmail?: string | undefined;
  accountPhone?: string | undefined;
};

/**
 * Creates a roster profile, and - only when the technician portal feature is
 * enabled - a linked TECHNICIAN login, in one transaction.
 *
 * The login is created with an UNUSABLE password hash plus a single-use activation
 * token. No administrator ever chooses or sees the technician's password, and no
 * default password exists anywhere in this codebase.
 */
export async function createTechnicianProfile(
  input: CreateTechnicianInput,
  actor: { id: string; role: 'ADMIN' },
  portalEnabled: boolean,
): Promise<{ technician: TechnicianRow; activationPath: string | null }> {
  const providerId = await resolveDefaultProviderId();
  const displayName = input.displayName.trim();
  const phone = emptyToNull(input.phone);

  const duplicate = await prisma.technician.findFirst({
    where: { providerId, OR: [{ displayName }, ...(phone ? [{ phone }] : [])] },
    select: { id: true },
  });
  if (duplicate) {
    throw new ApiError(
      'DUPLICATE_TECHNICIAN',
      'A technician with that name or mobile number already exists for this provider.',
      409,
    );
  }

  let account: { email: string; phone: string; token: string } | null = null;
  if (portalEnabled) {
    const email = (input.accountEmail ?? '').trim().toLowerCase();
    const accountPhone = (input.accountPhone ?? '').trim() || phone || '';
    if (!email || !accountPhone) {
      throw new ApiError(
        'ACCOUNT_REQUIRED',
        'The technician portal is enabled, so a login email and mobile number are required so an account can be provisioned.',
        422,
      );
    }
    account = { email, phone: accountPhone, token: generateToken(24) };

    // Pre-check the login identity so a duplicate is a clear 409 instead of a
    // constraint error. The unique index is still the authority: the catch below
    // covers a racing create.
    const taken = await prisma.user.findFirst({
      where: { OR: [{ email: account.email }, { phone: account.phone }] },
      select: { id: true },
    });
    if (taken) {
      throw new ApiError(
        'ACCOUNT_TAKEN',
        'That email or mobile number already belongs to an account.',
        409,
      );
    }
  }

  let technicianId: string;
  try {
    technicianId = await prisma.$transaction(async (tx) => {
      let userId: string | null = null;

      if (account) {
        const user = await tx.user.create({
          data: {
            email: account.email,
            phone: account.phone,
            name: displayName,
            role: 'TECHNICIAN',
            // Deactivating the profile must also stop the login, so the account
            // starts in the same activation state as its profile.
            isActive: input.isActive,
            // No usable password exists yet: the technician sets their own via the
            // activation link. `DUMMY_HASH` is the codebase's established "no valid
            // password" value and is not a credential for anything.
            passwordHash: DUMMY_HASH,
            activationTokenHash: sha256(account.token),
            activationExpiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
          },
          select: { id: true },
        });
        userId = user.id;
      }

      const created = await tx.technician.create({
        data: {
          providerId,
          userId,
          displayName,
          headline: emptyToNull(input.headline),
          skills: emptyToNull(input.skills),
          serviceAreas: emptyToNull(input.serviceAreas),
          phone,
          isActive: input.isActive,
          isAvailable: input.isAvailable,
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (err) {
    // The pre-check above covers the common case; this catches a racing create.
    if (isUniqueViolation(err)) {
      throw new ApiError(
        'ACCOUNT_TAKEN',
        'That email or mobile number already belongs to an account.',
        409,
      );
    }
    throw err;
  }

  const technician = await getTechnicianRow(technicianId);
  if (!technician) throw notFound('Technician');

  await audit({
    action: 'TECHNICIAN_CREATED',
    entityType: 'Technician',
    entityId: technician.id,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      providerId,
      displayName,
      isActive: technician.isActive,
      isAvailable: technician.isAvailable,
      accountProvisioned: Boolean(account),
    },
  });

  if (account) {
    // The token itself is NEVER written to the audit log - only the fact that an
    // invitation was issued, and to which account.
    await audit({
      action: 'TECHNICIAN_ACCOUNT_PROVISIONED',
      entityType: 'Technician',
      entityId: technician.id,
      actorId: actor.id,
      actorRole: actor.role,
      metadata: { accountEmail: account.email },
    });
  }

  return {
    technician,
    activationPath: account ? activationPathFor(account.token) : null,
  };
}

/**
 * Provisions a portal login for a profile that does not have one, or re-issues an
 * invitation that was never activated.
 *
 * This is the bridge between the four feature combinations: a roster built while
 * the portal was off can gain accounts later without recreating (and losing) the
 * profiles or their booking history. Rotating the token is also how a lost link is
 * recovered - this codebase has no password-reset subsystem, and an already
 * activated account is refused rather than silently locked out.
 */
export async function provisionTechnicianAccount(
  technicianId: string,
  input: { email?: string | undefined; phone?: string | undefined },
  actor: { id: string; role: 'ADMIN' },
): Promise<{ technician: TechnicianRow; activationPath: string }> {
  const existing = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: { id: true, displayName: true, isActive: true, userId: true },
  });
  if (!existing) throw notFound('Technician');

  if (existing.userId) {
    const account = await prisma.user.findUnique({
      where: { id: existing.userId },
      select: { activationExpiresAt: true },
    });

    if (!account || account.activationExpiresAt === null) {
      throw new ApiError(
        'ACCOUNT_EXISTS',
        'This technician has already activated their login. This release has no password-reset flow, so the account cannot be re-invited from here.',
        409,
      );
    }

    const token = generateToken(24);
    await prisma.user.update({
      where: { id: existing.userId },
      data: {
        activationTokenHash: sha256(token),
        activationExpiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
      },
      select: { id: true },
    });

    const technician = await getTechnicianRow(technicianId);
    if (!technician) throw notFound('Technician');

    await audit({
      action: 'TECHNICIAN_ACCOUNT_PROVISIONED',
      entityType: 'Technician',
      entityId: technicianId,
      actorId: actor.id,
      actorRole: actor.role,
      metadata: { reissued: true },
    });

    return { technician, activationPath: activationPathFor(token) };
  }

  const email = (input.email ?? '').trim().toLowerCase();
  const phone = (input.phone ?? '').trim();
  if (!email || !phone) {
    throw new ApiError(
      'ACCOUNT_DETAILS_REQUIRED',
      'A login email and mobile number are required to create the account.',
      422,
    );
  }

  const taken = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
    select: { id: true },
  });
  if (taken) {
    throw new ApiError(
      'ACCOUNT_TAKEN',
      'That email or mobile number already belongs to an account.',
      409,
    );
  }

  const token = generateToken(24);
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          name: existing.displayName,
          role: 'TECHNICIAN',
          isActive: existing.isActive,
          passwordHash: DUMMY_HASH,
          activationTokenHash: sha256(token),
          activationExpiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
        },
        select: { id: true },
      });
      await tx.technician.update({
        where: { id: technicianId },
        data: { userId: user.id },
        select: { id: true },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(
        'ACCOUNT_TAKEN',
        'That email or mobile number already belongs to an account.',
        409,
      );
    }
    throw err;
  }

  const technician = await getTechnicianRow(technicianId);
  if (!technician) throw notFound('Technician');

  await audit({
    action: 'TECHNICIAN_ACCOUNT_PROVISIONED',
    entityType: 'Technician',
    entityId: technicianId,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: { accountEmail: email, reissued: false },
  });

  return { technician, activationPath: activationPathFor(token) };
}

export type UpdateTechnicianInput = {
  displayName?: string | undefined;
  headline?: string | undefined;
  skills?: string | undefined;
  serviceAreas?: string | undefined;
  phone?: string | undefined;
  isActive?: boolean | undefined;
  isAvailable?: boolean | undefined;
};

/**
 * Updates roster details, and nothing else.
 *
 * `userId`, `providerId` and the rating aggregates are not writable, so a body
 * cannot repoint a profile at another account or provider. Deactivation is applied
 * to the linked login and its live sessions in the same operation (see the account
 * invariant at the top of this file).
 */
export async function updateTechnicianProfile(
  technicianId: string,
  input: UpdateTechnicianInput,
  actor: { id: string; role: 'ADMIN' },
): Promise<TechnicianRow> {
  const existing = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: {
      id: true,
      displayName: true,
      phone: true,
      isActive: true,
      isAvailable: true,
      userId: true,
    },
  });
  if (!existing) throw notFound('Technician');

  const data: Record<string, unknown> = {};
  if (input.displayName !== undefined) data.displayName = input.displayName.trim();
  if (input.headline !== undefined) data.headline = emptyToNull(input.headline);
  if (input.skills !== undefined) data.skills = emptyToNull(input.skills);
  if (input.serviceAreas !== undefined) data.serviceAreas = emptyToNull(input.serviceAreas);
  if (input.phone !== undefined) data.phone = emptyToNull(input.phone);
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.isAvailable !== undefined) data.isAvailable = input.isAvailable;

  // An empty patch is a no-op, not an audited change.
  if (Object.keys(data).length === 0) {
    const current = await getTechnicianRow(technicianId);
    if (!current) throw notFound('Technician');
    return current;
  }

  await prisma.technician.update({ where: { id: technicianId }, data, select: { id: true } });

  if (input.isActive !== undefined && existing.userId) {
    await prisma.user.update({
      where: { id: existing.userId },
      data: { isActive: input.isActive },
      select: { id: true },
    });
    if (!input.isActive) {
      const revokedSessions = await revokeUserSessions(existing.userId);
      await audit({
        action: 'TECHNICIAN_ACCOUNT_DISABLED',
        entityType: 'Technician',
        entityId: technicianId,
        actorId: actor.id,
        actorRole: actor.role,
        metadata: { reason: 'technician_deactivated', revokedSessions },
      });
    }
  }

  const technician = await getTechnicianRow(technicianId);
  if (!technician) throw notFound('Technician');

  await audit({
    action: 'TECHNICIAN_UPDATED',
    entityType: 'Technician',
    entityId: technicianId,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      changed: Object.keys(data).join(','),
      previousDisplayName: existing.displayName,
      previousPhone: existing.phone,
    },
  });

  if (input.isActive !== undefined && input.isActive !== existing.isActive) {
    await audit({
      action: 'TECHNICIAN_STATUS_CHANGED',
      entityType: 'Technician',
      entityId: technicianId,
      actorId: actor.id,
      actorRole: actor.role,
      metadata: { from: existing.isActive, to: input.isActive },
    });
  }

  if (input.isAvailable !== undefined && input.isAvailable !== existing.isAvailable) {
    await audit({
      action: 'TECHNICIAN_AVAILABILITY_CHANGED',
      entityType: 'Technician',
      entityId: technicianId,
      actorId: actor.id,
      actorRole: actor.role,
      metadata: { from: existing.isAvailable, to: input.isAvailable },
    });
  }

  return technician;
}
