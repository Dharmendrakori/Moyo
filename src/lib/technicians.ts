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
  // Expertise and coverage filters are substring matches on the stored tags, so a
  // partially typed value still narrows the roster.
  if (query.skill) where.skills = { contains: query.skill };
  if (query.area) where.serviceAreas = { contains: query.area };
  // Portal state is a LOGIN question, not a roster-activation question.
  if (query.portal === 'MISSING') where.user = { is: null };
  if (query.portal === 'LINKED') where.user = { isNot: null };
  if (query.portal === 'INVITED') where.user = { is: { activationExpiresAt: { not: null } } };

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

// ---------------------------------------------------------------------------
// Bulk roster operations
// ---------------------------------------------------------------------------

/**
 * Tag normalisation for the free-text `skills` / `serviceAreas` columns.
 *
 * The stored form is a comma-separated list. Bulk edits must never rewrite the
 * whole value: they merge (preserving every existing tag, de-duplicated
 * case-insensitively) or drop only the tags the operator named.
 */
function splitTags(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((tag) => tag.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  const merged = [...existing];
  for (const candidate of incoming) {
    const tag = candidate.trim().replace(/\s+/g, ' ');
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged;
}

function dropTags(existing: string[], incoming: string[]): string[] {
  const drop = new Set(incoming.map((tag) => tag.trim().replace(/\s+/g, ' ').toLowerCase()));
  return existing.filter((tag) => !drop.has(tag.toLowerCase()));
}

/** Column limits, mirroring the create/update schema bounds. */
const TAG_LIMITS = { skills: 300, serviceAreas: 200 } as const;

/** Statuses that mean a technician is still expected somewhere. */
const OPEN_ASSIGNMENT_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'TECHNICIAN_ASSIGNED',
  'TECHNICIAN_ON_THE_WAY',
  'ARRIVED',
  'SERVICE_IN_PROGRESS',
];

export type TechnicianBulkResult = {
  requested: number;
  affected: number;
  notFound: string[];
  /** Per-record reasons for records that were deliberately left untouched. */
  skipped: Array<{ id: string; name: string; reason: string }>;
  /**
   * One-time activation paths, returned ONLY by REISSUE_INVITATIONS. They are
   * never audited, logged or persisted, and the response that carries them is
   * never cached.
   */
  activationLinks?: Array<{ id: string; displayName: string; path: string }>;
};

export type TechnicianBulkInput = {
  action: string;
  ids: string[];
  values?: string[] | undefined;
};

/**
 * Applies one bulk roster operation.
 *
 * INVARIANTS THIS FUNCTION PRESERVES:
 * - Deactivation is refused outright while any selected technician still has open
 *   work. Silently deactivating them would strand a customer's booking, so the
 *   batch is rejected with the offending references and nothing is written.
 * - Availability is only ever set on ACTIVE profiles: an inactive technician can
 *   never become assignment-eligible through a bulk call.
 * - Skill/area edits are read-merge-write with an optimistic predicate, so a
 *   concurrent change is reported per record instead of being overwritten.
 * - Nothing here touches a booking, an invoice, a payment or an assignment.
 * - One summary audit event records the actor, the operation and the blast radius.
 */
export async function bulkUpdateTechnicians(
  input: TechnicianBulkInput,
  actor: { id: string; role: 'ADMIN' },
): Promise<TechnicianBulkResult> {
  const { action, ids } = input;
  const values = input.values ?? [];

  const rows = await prisma.technician.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      displayName: true,
      isActive: true,
      isAvailable: true,
      skills: true,
      serviceAreas: true,
      userId: true,
      user: { select: { activationExpiresAt: true } },
    },
  });

  const found = new Set(rows.map((row) => row.id));
  const notFound = ids.filter((id) => !found.has(id));
  const skipped: TechnicianBulkResult['skipped'] = [];
  let affected = 0;
  let activationLinks: TechnicianBulkResult['activationLinks'];

  if (action === 'ACTIVATE' || action === 'DEACTIVATE') {
    const isActive = action === 'ACTIVATE';

    if (!isActive) {
      const openWork = await prisma.booking.findMany({
        where: { technicianId: { in: ids }, status: { in: OPEN_ASSIGNMENT_STATUSES } },
        select: { technicianId: true, reference: true },
      });
      if (openWork.length > 0) {
        const names = new Map(rows.map((row) => [row.id, row.displayName]));
        const held = Array.from(new Set(openWork.map((b) => b.technicianId)))
          .map((id) => names.get(id ?? '') ?? 'Unknown technician')
          .slice(0, 3);
        const refs = openWork.map((b) => b.reference).slice(0, 3);
        throw new ApiError(
          'ACTIVE_ASSIGNMENTS',
          `Nothing was changed: ${openWork.length} open booking(s) are still assigned to these technicians (${held.join(
            ', ',
          )}; e.g. ${refs.join(', ')}). Reassign or complete that work first.`,
          409,
        );
      }
    }

    affected = await prisma.$transaction(async (tx) => {
      const result = await tx.technician.updateMany({
        where: { id: { in: ids } },
        data: { isActive },
      });

      const userIds = rows
        .map((row) => row.userId)
        .filter((value): value is string => typeof value === 'string');

      if (userIds.length > 0) {
        // The account invariant: a technician's login follows the roster state.
        await tx.user.updateMany({ where: { id: { in: userIds } }, data: { isActive } });
        if (!isActive) {
          await tx.session.updateMany({
            where: { userId: { in: userIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }

      return result.count;
    });
  } else if (action === 'SET_AVAILABLE' || action === 'SET_UNAVAILABLE') {
    const isAvailable = action === 'SET_AVAILABLE';
    const eligibleIds: string[] = [];

    for (const row of rows) {
      if (!row.isActive) {
        skipped.push({
          id: row.id,
          name: row.displayName,
          reason: 'Deactivated technicians cannot be marked available',
        });
        continue;
      }
      eligibleIds.push(row.id);
    }

    if (eligibleIds.length > 0) {
      const result = await prisma.technician.updateMany({
        where: { id: { in: eligibleIds }, isActive: true },
        data: { isAvailable },
      });
      affected = result.count;
    }
  } else if (
    action === 'ADD_SKILLS' ||
    action === 'REMOVE_SKILLS' ||
    action === 'ADD_SERVICE_AREAS' ||
    action === 'REMOVE_SERVICE_AREAS'
  ) {
    const isSkills = action.endsWith('SKILLS');
    const isRemove = action.startsWith('REMOVE_');
    const limit = isSkills ? TAG_LIMITS.skills : TAG_LIMITS.serviceAreas;

    const planned: Array<{ id: string; name: string; next: string; previous: string | null }> = [];

    for (const row of rows) {
      const previous = isSkills ? row.skills : row.serviceAreas;
      const current = splitTags(previous);
      const next = (isRemove ? dropTags(current, values) : mergeTags(current, values)).join(', ');

      if (next.length > limit) {
        skipped.push({
          id: row.id,
          name: row.displayName,
          reason: `The merged list would exceed ${limit} characters`,
        });
        continue;
      }
      if (next === (previous ?? '')) {
        // Nothing to change: reported, never counted as affected.
        skipped.push({
          id: row.id,
          name: row.displayName,
          reason: isRemove ? 'None of these values were present' : 'Already present',
        });
        continue;
      }
      planned.push({ id: row.id, name: row.displayName, next, previous });
    }

    if (planned.length > 0) {
      affected = await prisma.$transaction(async (tx) => {
        let count = 0;
        for (const item of planned) {
          // Optimistic predicate: only write if the value we merged from is still
          // the stored one, so a concurrent edit is never silently discarded.
          const result = await tx.technician.updateMany({
            where: isSkills
              ? { id: item.id, skills: item.previous }
              : { id: item.id, serviceAreas: item.previous },
            data: isSkills ? { skills: item.next } : { serviceAreas: item.next },
          });
          if (result.count === 1) count += 1;
          else
            skipped.push({
              id: item.id,
              name: item.name,
              reason: 'Changed by someone else meanwhile — reload and retry',
            });
        }
        return count;
      });
    }
  } else if (action === 'REISSUE_INVITATIONS') {
    const eligible = rows.filter((row) => {
      if (!row.userId) {
        skipped.push({
          id: row.id,
          name: row.displayName,
          reason: 'No portal login exists to invite',
        });
        return false;
      }
      if (row.user?.activationExpiresAt === null) {
        skipped.push({
          id: row.id,
          name: row.displayName,
          reason: 'Login already activated — there is no reset flow in this release',
        });
        return false;
      }
      return true;
    });

    if (eligible.length > 0) {
      const links: NonNullable<TechnicianBulkResult['activationLinks']> = [];
      await prisma.$transaction(async (tx) => {
        for (const row of eligible) {
          if (!row.userId) continue;
          const token = generateToken(24);
          await tx.user.update({
            where: { id: row.userId },
            data: {
              activationTokenHash: sha256(token),
              activationExpiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
            },
            select: { id: true },
          });
          links.push({ id: row.id, displayName: row.displayName, path: activationPathFor(token) });
        }
      });
      activationLinks = links;
      affected = links.length;
    }
  }

  await audit({
    action: 'TECHNICIAN_BULK_CHANGED',
    entityType: 'Technician',
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      operation: action,
      requested: ids.length,
      affected,
      notFound: notFound.length,
      skipped: skipped.length,
      // Operator-entered expertise text only; never credentials.
      values: values.length > 0 ? values.join(', ').slice(0, 500) : null,
      ids: ids.join(',').slice(0, 1500),
    },
  });

  return { requested: ids.length, affected, notFound, skipped, activationLinks };
}

