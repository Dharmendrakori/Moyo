/// <reference types="vitest/globals" />

import { createHash } from 'node:crypto';
import { sessionState } from './session-control';

/**
 * Shared in-memory Prisma fixture for the TECHNICIAN suites.
 *
 * It implements only the queries the technician routes, guards and pages issue,
 * and mirrors the behaviours those paths depend on:
 *
 *  - `session.findUnique` resolves the seeded USER and its linked Technician row,
 *    so a role/technician decision is made from stored state, exactly as
 *    `getCurrentUser` does;
 *  - `technician.findFirst` honours the `where` filters the eligibility helper
 *    builds, so "inactive" and "unavailable" are decided by data, not by the mock;
 *  - `technicianFeatureConfig` starts EMPTY, which is what the real database looks
 *    like after `db push`: the safe defaults must come from the application.
 *
 * Not a Prisma emulator: anything a test does not exercise is absent on purpose.
 * Separate from `booking-store.ts` so the existing booking suites keep their
 * fixture unchanged.
 */

export const ADMIN_ID = 'cadmin0000000000000000001';
export const CUSTOMER_ID = 'ccustomer00000000000000001';
export const TECHNICIAN_USER_ID = 'ctechuser0000000000000001';
export const OTHER_TECH_USER_ID = 'ctechuser0000000000000002';
export const TECHNICIAN_ID = 'ctechnician00000000000001';
export const OTHER_TECH_ID = 'ctechnician00000000000002';
export const PROVIDER_ID = 'cprovider0000000000000001';
export const BOOKING_ID = 'cbooking0000000000000001';
export const OTHER_BOOKING_ID = 'cbooking0000000000000002';
export const ORIGIN = 'http://localhost:3000';
export const CSRF = 'csrf-token';

export type UserRow = {
  id: string;
  email: string;
  phone: string;
  name: string;
  role: string;
  isActive: boolean;
  passwordHash: string;
  activationTokenHash: string | null;
  activationExpiresAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
};

export type TechnicianRow = {
  id: string;
  providerId: string;
  userId: string | null;
  displayName: string;
  headline: string | null;
  skills: string | null;
  serviceAreas: string | null;
  phone: string | null;
  isActive: boolean;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FeatureRow = {
  id: string;
  adminManagementEnabled: boolean;
  portalEnabled: boolean;
};

export type JobRow = {
  id: string;
  reference: string;
  status: string;
  technicianId: string | null;
  customerId: string;
  scheduledFor: Date | null;
};

export const userRows: UserRow[] = [];
export const technicianRows: TechnicianRow[] = [];
export const featureRows: FeatureRow[] = [];
export const jobRows: JobRow[] = [];
export const auditRows: Array<{ action: string; entityId?: string; metadata?: unknown }> = [];
export const sessionRevocations: Array<{ userId: string }> = [];

/**
 * Test hooks for states the database cannot normally produce, or that a route
 * must be able to survive: an unreadable configuration row, and the projection a
 * query was actually issued with.
 */
export const storeFlags = { failFeatureRead: false };
export const probe: { lastBookingSelect: Record<string, unknown> | null } = {
  lastBookingSelect: null,
};

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export function resetTechnicianStore(): void {
  userRows.length = 0;
  technicianRows.length = 0;
  featureRows.length = 0;
  jobRows.length = 0;
  auditRows.length = 0;
  sessionRevocations.length = 0;
  storeFlags.failFeatureRead = false;
  probe.lastBookingSelect = null;
}

export function seedUser(row: Partial<UserRow> & { id: string; role: string }): UserRow {
  const full: UserRow = {
    email: `${row.id}@example.com`,
    phone: '9876500000',
    name: 'Test User',
    isActive: true,
    passwordHash: 'unusable',
    activationTokenHash: null,
    activationExpiresAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    passwordChangedAt: new Date('2026-01-01T00:00:00Z'),
    ...row,
  };
  userRows.push(full);
  return full;
}

export function seedTechnician(
  row: Partial<TechnicianRow> & { id: string; displayName: string },
): TechnicianRow {
  const full: TechnicianRow = {
    providerId: PROVIDER_ID,
    userId: null,
    headline: null,
    skills: null,
    serviceAreas: null,
    phone: null,
    isActive: true,
    isAvailable: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...row,
  };
  technicianRows.push(full);
  return full;
}

/** A technician user with a linked, active profile - the happy path. */
export function seedPortalTechnician(options?: {
  userId?: string;
  technicianId?: string;
  isActive?: boolean;
  isAvailable?: boolean;
  accountActive?: boolean;
}): { userId: string; technicianId: string } {
  const userId = options?.userId ?? TECHNICIAN_USER_ID;
  const technicianId = options?.technicianId ?? TECHNICIAN_ID;

  seedUser({
    id: userId,
    role: 'TECHNICIAN',
    name: 'Ravi Kumar',
    email: `${userId}@example.com`,
    isActive: options?.accountActive ?? true,
  });
  seedTechnician({
    id: technicianId,
    userId,
    displayName: 'Ravi Kumar',
    isActive: options?.isActive ?? true,
    isAvailable: options?.isAvailable ?? true,
  });

  return { userId, technicianId };
}

export function seedJob(row: Partial<JobRow> & { id: string; status: string }): JobRow {
  const full: JobRow = {
    reference: `SERIC-2026-${row.id.slice(-6)}`,
    technicianId: TECHNICIAN_ID,
    customerId: CUSTOMER_ID,
    scheduledFor: null,
    ...row,
  };
  jobRows.push(full);
  return full;
}


// ---------------------------------------------------------------------------
// Where-clause matching
// ---------------------------------------------------------------------------

type Contains = { contains: string };

function matchesTechnicianRow(
  row: TechnicianRow,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  if (typeof where.id === 'string' && row.id !== where.id) return false;
  if (typeof where.providerId === 'string' && row.providerId !== where.providerId) return false;
  if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
  if (where.isAvailable !== undefined && row.isAvailable !== where.isAvailable) return false;

  const or = where.OR as Array<Record<string, unknown>> | undefined;
  if (or) {
    const matched = or.some((clause) => {
      const name = clause.displayName as string | Contains | undefined;
      if (typeof name === 'string') return row.displayName === name;
      if (name && 'contains' in name) {
        return row.displayName.toLowerCase().includes(name.contains.toLowerCase());
      }
      const phone = clause.phone as string | Contains | undefined;
      if (typeof phone === 'string') return row.phone === phone;
      if (phone && 'contains' in phone) return (row.phone ?? '').includes(phone.contains);
      const skills = clause.skills as Contains | undefined;
      if (skills && 'contains' in skills) {
        return (row.skills ?? '').toLowerCase().includes(skills.contains.toLowerCase());
      }
      const areas = clause.serviceAreas as Contains | undefined;
      if (areas && 'contains' in areas) {
        return (row.serviceAreas ?? '').toLowerCase().includes(areas.contains.toLowerCase());
      }
      return false;
    });
    if (!matched) return false;
  }

  return true;
}

function withUser(row: TechnicianRow) {
  const user = row.userId ? (userRows.find((u) => u.id === row.userId) ?? null) : null;
  return {
    ...row,
    user: user
      ? {
          id: user.id,
          email: user.email,
          isActive: user.isActive,
          activationExpiresAt: user.activationExpiresAt,
        }
      : null,
  };
}

function matchesJobRow(row: JobRow, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  if (typeof where.id === 'string' && row.id !== where.id) return false;
  if (typeof where.technicianId === 'string' && row.technicianId !== where.technicianId) {
    return false;
  }
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  const inStatuses = (where.status as { in?: string[] } | undefined)?.in;
  if (inStatuses && !inStatuses.includes(row.status)) return false;
  return true;
}


/** Builds the Prisma double. Every suite registers its own instance. */
export function makePrismaMock() {
  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        if (where?.tokenHash !== hash(`token-${userId}`)) return null;
        const user = userRows.find((u) => u.id === userId);
        if (!user) return null;
        const technician = technicianRows.find((t) => t.userId === userId) ?? null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? CSRF,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          userId,
          user: { ...user, provider: null, technician },
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'csession0000000000000001',
        userId: data.userId,
      }),
      updateMany: async ({ where }: { where: { userId?: string | { in: string[] } } }) => {
        const userId = where.userId;
        if (typeof userId === 'string') sessionRevocations.push({ userId });
        if (userId && typeof userId === 'object' && Array.isArray(userId.in)) {
          for (const id of userId.in) sessionRevocations.push({ userId: id });
        }
        return { count: 1 };
      },
    },
    user: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = userRows.find((u) => {
          if (typeof where.id === 'string') return u.id === where.id;
          if (typeof where.email === 'string') return u.email === where.email;
          if (typeof where.phone === 'string') return u.phone === where.phone;
          if (typeof where.activationTokenHash === 'string') {
            return u.activationTokenHash === where.activationTokenHash;
          }
          const or = where.OR as Array<Record<string, unknown>> | undefined;
          if (or) {
            return or.some(
              (clause) =>
                (typeof clause.email === 'string' && u.email === clause.email) ||
                (typeof clause.phone === 'string' && u.phone === clause.phone),
            );
          }
          return false;
        });
        if (!row) return null;
        const technician = technicianRows.find((t) => t.userId === row.id) ?? null;
        return { ...row, technician };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = userRows.find((u) => u.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where?: { role?: string } } = {}) =>
        userRows.filter((u) => !where?.role || u.role === where.role).map((u) => ({ id: u.id })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = seedUser({
          id: `cuser${String(userRows.length).padStart(20, '0')}`,
          role: String(data.role),
          email: String(data.email),
          phone: String(data.phone),
          name: String(data.name),
          isActive: data.isActive !== false,
          passwordHash: String(data.passwordHash ?? 'unusable'),
          activationTokenHash: (data.activationTokenHash as string | null) ?? null,
          activationExpiresAt: (data.activationExpiresAt as Date | null) ?? null,
        });
        return { id: row.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = userRows.find((u) => u.id === where.id);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        Object.assign(row, data);
        return { id: row.id };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = userRows.find((u) => u.id === where.id);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    technician: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = technicianRows.find((t) => matchesTechnicianRow(t, where));
        return row ? withUser(row) : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = technicianRows.find((t) => t.id === where.id);
        return row ? withUser(row) : null;
      },
      findMany: async ({
        where,
        skip = 0,
        take = 100,
      }: { where?: Record<string, unknown>; skip?: number; take?: number } = {}) =>
        technicianRows
          .filter((t) => matchesTechnicianRow(t, where))
          .slice(skip, skip + take)
          .map(withUser),
      count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        technicianRows.filter((t) => matchesTechnicianRow(t, where)).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = seedTechnician({
          id: `ctechnician${String(technicianRows.length).padStart(14, '0')}`,
          displayName: String(data.displayName),
          providerId: String(data.providerId),
          userId: (data.userId as string | null) ?? null,
          headline: (data.headline as string | null) ?? null,
          skills: (data.skills as string | null) ?? null,
          serviceAreas: (data.serviceAreas as string | null) ?? null,
          phone: (data.phone as string | null) ?? null,
          isActive: data.isActive === true,
          isAvailable: data.isAvailable === true,
        });
        return { id: row.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = technicianRows.find((t) => t.id === where.id);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        Object.assign(row, data, { updatedAt: new Date() });
        return withUser(row);
      },
    },
    technicianFeatureConfig: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (storeFlags.failFeatureRead) throw new Error('database unavailable');
        return featureRows.find((f) => f.id === where.id) ?? null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = featureRows.find((f) => f.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row: FeatureRow = {
          id: where.id,
          adminManagementEnabled: create.adminManagementEnabled !== false,
          portalEnabled: create.portalEnabled === true,
        };
        featureRows.push(row);
        return { ...row };
      },
    },
    provider: {
      findMany: async () => [{ id: PROVIDER_ID }],
    },
    booking: {
      findFirst: async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        // Recorded so a test can prove which projection a portal query used.
        probe.lastBookingSelect = select ?? null;
        const row = jobRows.find((j) => matchesJobRow(j, where));
        if (!row) return null;
        return {
          ...row,
          mode: 'INSTANT',
          serviceType: 'REPAIR',
          createdAt: new Date('2026-01-02T09:00:00Z'),
          updatedAt: new Date('2026-01-02T09:00:00Z'),
          addressLine1: '12 Test Street',
          addressLine2: null,
          area: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
          landmark: null,
          contactName: 'Asha Verma',
          contactPhone: '9876543210',
          description: 'AC not cooling',
          isEmergency: false,
          service: { name: 'AC Repair' },
          customer: { name: 'Asha Verma' },
          technician: { id: row.technicianId, displayName: 'Ravi Kumar', phone: '9876500000' },
          statusEvents: [],
        };
      },
      findMany: async ({
        where,
        skip = 0,
        take = 100,
      }: { where?: Record<string, unknown>; skip?: number; take?: number } = {}) =>
        jobRows
          .filter((j) => matchesJobRow(j, where))
          .slice(skip, skip + take)
          .map((j) => ({
            ...j,
            mode: 'INSTANT',
            createdAt: new Date('2026-01-02T09:00:00Z'),
            area: 'Indiranagar',
            city: 'Bengaluru',
            service: { name: 'AC Repair' },
          })),
      count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        jobRows.filter((j) => matchesJobRow(j, where)).length,
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({
          action: String(data.action),
          entityId: (data.entityId as string | null) ?? undefined,
          metadata: data.metadata,
        });
        return undefined;
      },
    },
  };
  prisma.$transaction = async (fn: (tx: Record<string, unknown>) => unknown) => fn(prisma);
  return prisma;
}
