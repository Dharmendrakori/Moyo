import 'server-only';
import { prisma } from './prisma';
import { audit } from './audit';
import { ApiError, notFound } from './api';
import { CHARGING_LABEL, CHARGING_OPTIONS, type ChargingOption, type ServiceType } from './domain';
import {
  BUDGET_CEILING_PAISE,
  BUDGET_FLOOR_PAISE,
  type adminCategoryBulkSchema,
  type adminChargingBulkSchema,
  type adminChargingOptionSchema,
  type adminPriceSchema,
  type adminServiceBulkSchema,
  type adminServiceCreateSchema,
} from './validation';
import type { z } from 'zod';

/**
 * ADMIN CATALOG READ / WRITE MODELS
 *
 * Server-only data access for the Seric Tech Solutions operations console.
 *
 * FOUR RULES ARE ENFORCED HERE, NOT IN THE UI:
 *
 * 1. MINIMISATION. Every query uses an explicit `select`. No password hash,
 *    session token, IP hash or unrelated personal data can reach the browser,
 *    because those columns are never fetched in the first place.
 *
 * 2. HISTORICAL PRICES ARE IMMUTABLE. `Booking.quotedPaise`, `budgetMinPaise`
 *    and `budgetMaxPaise` are SNAPSHOTS taken when the booking was created. A
 *    price mutation in this file updates `ServiceOption` ONLY - it never reads
 *    or writes a Booking row. Re-pricing the catalogue therefore cannot
 *    silently rewrite what a customer was quoted, which is both a correctness
 *    and a consumer-protection property.
 *
 * 3. THE ROW IS THE AUTHORITY. The target record is located by primary key
 *    from the URL path and its real state is re-read from the database before
 *    any write. The browser's view of the current value is never trusted.
 *
 * 4. AUTHORITY IS THE CALLER'S JOB. These functions assume `requireAdmin()` has
 *    already run at the route boundary. They take the actor explicitly so the
 *    audit record names the operator who acted, not a module-level global.
 */

export type AdminActor = { id: string; role: 'ADMIN' };

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type AdminCategoryRow = {
  id: string;
  code: string;
  position: number;
  name: string;
  slug: string;
  description: string | null;
  iconKey: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  subCategoryCount: number;
  serviceCount: number;
  activeServiceCount: number;
};

/**
 * All categories with live service counts, in authoritative position order.
 *
 * THE 20 OFFICIAL CATEGORIES ARE READ FROM THE DATABASE, NEVER FROM A
 * CLIENT-SIDE CONSTANT. A duplicated list would drift, and would let the
 * console claim a category exists when the catalogue does not contain it.
 */
export async function listAdminCategories(): Promise<AdminCategoryRow[]> {
  const rows = await prisma.category.findMany({
    orderBy: { position: 'asc' },
    select: {
      id: true,
      code: true,
      position: true,
      name: true,
      slug: true,
      description: true,
      iconKey: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { subCategories: true } },
      subCategories: { select: { services: { select: { id: true, isActive: true } } } },
    },
  });

  return rows.map((row) => {
    const services = row.subCategories.flatMap((sub) => sub.services);
    return {
      id: row.id,
      code: row.code,
      position: row.position,
      name: row.name,
      slug: row.slug,
      description: row.description,
      iconKey: row.iconKey,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      subCategoryCount: row._count.subCategories,
      serviceCount: services.length,
      activeServiceCount: services.filter((s) => s.isActive).length,
    };
  });
}

/** Category options for the service/pricing table filters (read from the DB). */
export async function listCategoryOptions(): Promise<Array<{ slug: string; name: string }>> {
  return prisma.category.findMany({ orderBy: { position: 'asc' }, select: { slug: true, name: true } });
}

/**
 * Activates or deactivates a category.
 *
 * Name, code and position are NOT editable: they are the authoritative official
 * catalogue identity. Deactivating a category hides it from the customer site
 * but never deletes it, so no booking history is lost.
 */
export async function setCategoryActive(
  categoryId: string,
  isActive: boolean,
  actor: AdminActor,
): Promise<{ id: string; isActive: boolean }> {
  const current = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, isActive: true },
  });
  if (!current) throw notFound('Category');

  const updated = await prisma.category.update({
    where: { id: categoryId },
    data: { isActive },
    select: { id: true, isActive: true },
  });

  await audit({
    action: 'CATEGORY_STATUS_CHANGED',
    entityType: 'Category',
    entityId: categoryId,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: { previousIsActive: current.isActive, isActive },
  });

  return updated;
}
// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type AdminServiceListItem = {
  id: string;
  name: string;
  slug: string;
  serviceType: string;
  isActive: boolean;
  categoryName: string;
  categorySlug: string;
  subCategoryName: string;
  /** Which charging options are enabled. Drives the coverage badges. */
  activeCharging: ChargingOption[];
  publishedCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminServiceQuery = {
  q?: string;
  category?: string;
  status: 'ALL' | 'ACTIVE' | 'INACTIVE';
  charging: 'ALL' | ChargingOption;
  page: number;
  pageSize: number;
};

/**
 * Builds the Prisma `where` for the service table.
 *
 * `contains` is applied to name and slug only. The term is already
 * length-bounded and control-character stripped by `adminServiceQuerySchema`.
 */
function serviceWhere(query: AdminServiceQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (query.q) where.OR = [{ name: { contains: query.q } }, { slug: { contains: query.q } }];
  if (query.status === 'ACTIVE') where.isActive = true;
  if (query.status === 'INACTIVE') where.isActive = false;
  if (query.category) where.subCategory = { category: { slug: query.category } };
  if (query.charging !== 'ALL') where.options = { some: { charging: query.charging, isActive: true } };
  return where;
}

export async function listAdminServices(query: AdminServiceQuery) {
  const where = serviceWhere(query);

  const [rows, total] = await Promise.all([
    prisma.service.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        serviceType: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        subCategory: {
          select: { name: true, category: { select: { name: true, slug: true } } },
        },
        options: { select: { charging: true, pricePaise: true, isActive: true } },
      },
    }),
    prisma.service.count({ where }),
  ]);

  const items: AdminServiceListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    serviceType: row.serviceType,
    isActive: row.isActive,
    categoryName: row.subCategory.category.name,
    categorySlug: row.subCategory.category.slug,
    subCategoryName: row.subCategory.name,
    activeCharging: row.options
      .filter((o) => o.isActive)
      .map((o) => o.charging)
      .filter((c): c is ChargingOption => (CHARGING_OPTIONS as readonly string[]).includes(c)),
    publishedCount: row.options.filter((o) => o.isActive && o.pricePaise != null).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** Full service detail for the admin detail screen. */
export async function getAdminService(serviceId: string) {
  return prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      includedWork: true,
      serviceType: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      subCategory: {
        select: {
          id: true,
          name: true,
          slug: true,
          category: { select: { id: true, name: true, slug: true, position: true } },
        },
      },
      options: {
        orderBy: { charging: 'asc' },
        select: {
          id: true,
          charging: true,
          pricePaise: true,
          budgetMinPaise: true,
          budgetMaxPaise: true,
          durationMinMinutes: true,
          isActive: true,
        },
      },
      _count: {
        select: {
          bookings: true,
          providers: true,
        },
      },
    },
  });
}

/**
 * How many existing bookings carry a fixed quote for this service.
 *
 * This is a SEPARATE, explicitly scoped query because it exists purely to warn
 * the operator before a price change: it tells them how many agreed quotes
 * would be affected, while making it structurally impossible for the price
 * mutation to rewrite any of them.
 */
export async function countServiceQuotedBookings(serviceId: string): Promise<number> {
  return prisma.booking.count({ where: { serviceId, quotedPaise: { not: null } } });
}

/** Activates or deactivates a single service. */
export async function setServiceActive(
  serviceId: string,
  isActive: boolean,
  actor: AdminActor,
): Promise<{ id: string; isActive: boolean }> {
  const current = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true, isActive: true },
  });
  if (!current) throw notFound('Service');

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: { isActive },
    select: { id: true, isActive: true },
  });

  await audit({
    action: 'SERVICE_STATUS_CHANGED',
    entityType: 'Service',
    entityId: serviceId,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: { previousIsActive: current.isActive, isActive },
  });

  return updated;
}
// ---------------------------------------------------------------------------
// Bulk administration
// ---------------------------------------------------------------------------

/**
 * Server-side slug derivation, mirroring `prisma/seed.ts`.
 *
 * The slug is NEVER accepted from the client: it is derived here from the
 * validated name so a caller cannot place a service under an arbitrary URL.
 */
function slugifyService(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export type BulkResult = {
  /** How many ids the client submitted (after de-duplication). */
  requested: number;
  /** How many rows were actually changed / deleted. */
  affected: number;
  /** Submitted ids that do not exist in the database. */
  notFound: string[];
  /** For DELETE: records that were protected and therefore NOT deleted. */
  protected?: Array<{ id: string; name: string; reason: string }>;
  /** For CREATE: services that could not be created (e.g. duplicate name). */
  skipped?: Array<{ name: string; reason: string }>;
  /** For CREATE: the services that were created. */
  created?: Array<{ id: string; name: string; slug: string }>;
};

/** Splits submitted ids into the ones that exist and the ones that do not. */
async function partitionExisting(
  ids: string[],
  load: (existingIds: string[]) => Promise<Array<{ id: string }>>,
): Promise<{ existingIds: string[]; notFound: string[] }> {
  const rows = await load(ids);
  const existingIds = rows.map((r) => r.id);
  const found = new Set(existingIds);
  return { existingIds, notFound: ids.filter((id) => !found.has(id)) };
}

/**
 * Activates or deactivates several official categories at once.
 *
 * Only `isActive` is written. Name, code and position are absent from the
 * schema and from this function, so the official catalogue identity cannot be
 * touched by a bulk call. One summary audit event records the blast radius.
 */
export async function bulkSetCategoryActive(
  input: z.infer<typeof adminCategoryBulkSchema>,
  actor: AdminActor,
): Promise<BulkResult> {
  const isActive = input.action === 'ACTIVATE';

  const { existingIds, notFound } = await partitionExisting(input.ids, (existingIds) =>
    prisma.category.findMany({ where: { id: { in: existingIds } }, select: { id: true } }),
  );

  const { count } = await prisma.category.updateMany({
    where: { id: { in: existingIds } },
    data: { isActive },
  });

  await audit({
    action: 'CATEGORY_BULK_STATUS_CHANGED',
    entityType: 'Category',
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      action: input.action,
      requested: input.ids.length,
      affected: count,
      notFound: notFound.length,
    },
  });

  return { requested: input.ids.length, affected: count, notFound };
}

/**
 * Activates or deactivates several services at once.
 *
 * Identical guarantees to the single-service toggle, applied to a set: only
 * `isActive` changes, the row is located by primary key, and the change is
 * audited. Deactivating makes a service unbookable without deleting it or its
 * history.
 */
export async function bulkSetServiceActive(
  input: z.infer<typeof adminServiceBulkSchema>,
  actor: AdminActor,
): Promise<BulkResult> {
  const isActive = input.action === 'ACTIVATE';

  const { existingIds, notFound } = await partitionExisting(input.ids, (existingIds) =>
    prisma.service.findMany({ where: { id: { in: existingIds } }, select: { id: true } }),
  );

  const { count } = await prisma.service.updateMany({
    where: { id: { in: existingIds } },
    data: { isActive },
  });

  await audit({
    action: 'SERVICE_BULK_STATUS_CHANGED',
    entityType: 'Service',
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      action: input.action,
      requested: input.ids.length,
      affected: count,
      notFound: notFound.length,
    },
  });

  return { requested: input.ids.length, affected: count, notFound };
}

// ---------------------------------------------------------------------------
// Charging options
// ---------------------------------------------------------------------------

export type AdminChargingOptionRow = {
  id: string;
  serviceId: string;
  charging: string;
  pricePaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  durationMinMinutes: number | null;
  isActive: boolean;
  serviceName: string;
  serviceSlug: string;
  serviceActive: boolean;
  categoryName: string;
  categorySlug: string;
  subCategoryName: string;
};

/** One service with all three charging options attached. The unified table row. */
export type AdminChargingServiceRow = {
  serviceId: string;
  serviceName: string;
  serviceActive: boolean;
  categoryName: string;
  categorySlug: string;
  subCategoryName: string;
  options: {
    charging: ChargingOption;
    optionId: string;
    isActive: boolean;
    pricePaise: number | null;
    budgetMinPaise: number | null;
    budgetMaxPaise: number | null;
    durationMinMinutes: number | null;
  }[];
};

export type AdminChargingServiceQuery = {
  q?: string;
  category?: string;
  charging: 'ALL' | ChargingOption;
  status: 'ALL' | 'ENABLED' | 'DISABLED';
  page: number;
  pageSize: number;
};

/**
 * Builds the Prisma `where` for the unified charging-options table.
 *
 * Filters mirror the admin service table: the search term applies to service
 * name/slug only, `charging` requires that option to be enabled, and `status`
 * constrains whether ANY of the three options is enabled. All three options
 * stay attached to the row so each can be configured independently.
 */
function chargingServiceWhere(query: AdminChargingServiceQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (query.q) where.OR = [{ name: { contains: query.q } }, { slug: { contains: query.q } }];
  if (query.category) where.subCategory = { category: { slug: query.category } };
  const optionClauses: Array<Record<string, unknown>> = [];
  if (query.charging !== 'ALL') optionClauses.push({ options: { some: { charging: query.charging, isActive: true } } });
  if (query.status === 'ENABLED') optionClauses.push({ options: { some: { isActive: true } } });
  if (query.status === 'DISABLED') optionClauses.push({ options: { none: { isActive: true } } });
  if (optionClauses.length === 1) Object.assign(where, optionClauses[0]);
  if (optionClauses.length > 1) where.AND = optionClauses;
  return where;
}

/**
 * Every service with its three charging options, paginated.
 *
 * Each service appears exactly ONCE. The three `ServiceOption` rows are grouped
 * under it in canonical `CHARGING_OPTIONS` order so the single Configure dialog
 * can update each one through the existing PATCH endpoint without touching the
 * other two. No new schema, API, or persistence path is introduced.
 */
export async function listAdminChargingServices(query: AdminChargingServiceQuery) {
  const where = chargingServiceWhere(query);

  const [rows, total] = await Promise.all([
    prisma.service.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        isActive: true,
        subCategory: { select: { name: true, category: { select: { name: true, slug: true } } } },
        options: {
          select: {
            id: true,
            charging: true,
            pricePaise: true,
            budgetMinPaise: true,
            budgetMaxPaise: true,
            durationMinMinutes: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.service.count({ where }),
  ]);

  const items: AdminChargingServiceRow[] = rows.map((row) => ({
    serviceId: row.id,
    serviceName: row.name,
    serviceActive: row.isActive,
    categoryName: row.subCategory.category.name,
    categorySlug: row.subCategory.category.slug,
    subCategoryName: row.subCategory.name,
    options: CHARGING_OPTIONS.map((charging) => {
      const option = row.options.find((o) => o.charging === charging);
      return {
        charging,
        optionId: option?.id ?? '',
        isActive: option?.isActive ?? false,
        pricePaise: option?.pricePaise ?? null,
        budgetMinPaise: option?.budgetMinPaise ?? null,
        budgetMaxPaise: option?.budgetMaxPaise ?? null,
        durationMinMinutes: option?.durationMinMinutes ?? null,
      };
    }),
  }));

  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** Every `ServiceOption` row with its service and category context. */
export async function listAdminChargingOptions(): Promise<AdminChargingOptionRow[]> {
  const rows = await prisma.serviceOption.findMany({
    orderBy: [{ charging: 'asc' }, { service: { name: 'asc' } }],
    select: {
      id: true,
      serviceId: true,
      charging: true,
      pricePaise: true,
      budgetMinPaise: true,
      budgetMaxPaise: true,
      durationMinMinutes: true,
      isActive: true,
      service: {
        select: {
          name: true,
          slug: true,
          isActive: true,
          subCategory: {
            select: { name: true, category: { select: { name: true, slug: true } } },
          },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    serviceId: r.serviceId,
    charging: r.charging,
    pricePaise: r.pricePaise,
    budgetMinPaise: r.budgetMinPaise,
    budgetMaxPaise: r.budgetMaxPaise,
    durationMinMinutes: r.durationMinMinutes,
    isActive: r.isActive,
    serviceName: r.service.name,
    serviceSlug: r.service.slug,
    serviceActive: r.service.isActive,
    categoryName: r.service.subCategory.category.name,
    categorySlug: r.service.subCategory.category.slug,
    subCategoryName: r.service.subCategory.name,
  }));
}

/**
 * Applies an admin charging-option configuration.
 *
 * Server-side re-validation that Zod alone cannot do, because it depends on the
 * ROW's charging type rather than on the request:
 *  - budget bounds are meaningful ONLY for CUSTOMER_BUDGET and are rejected on
 *    the other two options, so a stray value cannot silently alter the
 *    semantics of a visit or fixed charge;
 *  - a Customer Budget option must have bounds before it can be enabled,
 *    because `resolveBookingPricing` rejects an unbounded budget request and
 *    the mode would otherwise always fail at checkout.
 *
 * This function never touches `pricePaise`. Enabling an option must not be able
 * to expose a price; publication is a separate, separately audited action.
 */
export async function setChargingOption(
  optionId: string,
  input: z.infer<typeof adminChargingOptionSchema>,
  actor: AdminActor,
): Promise<{ id: string; isActive: boolean }> {
  const current = await prisma.serviceOption.findUnique({
    where: { id: optionId },
    select: {
      id: true,
      charging: true,
      isActive: true,
      budgetMinPaise: true,
      budgetMaxPaise: true,
    },
  });
  if (!current) throw notFound('Charging option');

  const isBudgetMode = current.charging === 'CUSTOMER_BUDGET';
  const { budgetMinPaise, budgetMaxPaise, durationMinMinutes } = input;

  if (!isBudgetMode && (budgetMinPaise != null || budgetMaxPaise != null)) {
    throw new ApiError(
      'BUDGET_NOT_APPLICABLE',
      'Budget bounds apply only to the Customer Budget option',
      422,
    );
  }

  if (isBudgetMode && budgetMinPaise != null && budgetMaxPaise != null) {
    if (budgetMinPaise < BUDGET_FLOOR_PAISE || budgetMaxPaise > BUDGET_CEILING_PAISE) {
      throw new ApiError('BUDGET_OUT_OF_RANGE', 'Budget bounds are outside the permitted range', 422);
    }
    if (budgetMinPaise > budgetMaxPaise) {
      throw new ApiError('BUDGET_OUT_OF_RANGE', 'Budget minimum cannot exceed the maximum', 422);
    }
  }

  const effectiveMin = budgetMinPaise !== undefined ? budgetMinPaise : current.budgetMinPaise;
  const effectiveMax = budgetMaxPaise !== undefined ? budgetMaxPaise : current.budgetMaxPaise;

  // Enabling Customer Budget without bounds would advertise a mode that
  // `resolveBookingPricing` always rejects at checkout.
  if (isBudgetMode && input.isActive && (effectiveMin == null || effectiveMax == null)) {
    throw new ApiError(
      'BUDGET_RANGE_REQUIRED',
      'Set a minimum and maximum budget before enabling Customer Budget',
      422,
    );
  }

  const updated = await prisma.serviceOption.update({
    where: { id: optionId },
    data: {
      isActive: input.isActive,
      // Budget fields are only ever written for the mode that owns them, so a
      // stale value can never leak onto a visit or fixed charge.
      ...(isBudgetMode
        ? { budgetMinPaise: effectiveMin ?? null, budgetMaxPaise: effectiveMax ?? null }
        : {}),
      durationMinMinutes: durationMinMinutes ?? null,
    },
    select: { id: true, isActive: true },
  });

  await audit({
    action: 'CHARGING_OPTION_CHANGED',
    entityType: 'ServiceOption',
    entityId: optionId,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      charging: current.charging,
      previousIsActive: current.isActive,
      isActive: input.isActive,
      // Budget bounds are commercial configuration, not personal data, and are
      // logged so a disputed quote can be reconstructed.
      budgetMinPaise: effectiveMin ?? null,
      budgetMaxPaise: effectiveMax ?? null,
    },
  });

  return updated;
}

/**
 * Enables or disables ONE charging type across several services.
 *
 * The request names a single charging type and the write model filters on it,
 * so the independence the single-option endpoint guarantees holds by
 * construction: a bulk Visit Charge operation cannot touch a Fixed Charge or
 * Customer Budget row, and vice versa. Only `isActive` is written - budget
 * bounds, duration and price are unreachable from here, so enabling can never
 * expose a price.
 *
 * Customer Budget carries one extra server-side rule, the same one
 * `setChargingOption` enforces: an option without a min/max range would
 * advertise a mode `resolveBookingPricing` always rejects at checkout. Rather
 * than failing the whole batch, such rows are SKIPPED and reported by name, so
 * the operator sees exactly which services could not be changed and why.
 * Unknown service ids are reported as `notFound`. One summary audit event
 * records the blast radius.
 */
export async function bulkSetChargingOptionActive(
  input: z.infer<typeof adminChargingBulkSchema>,
  actor: AdminActor,
): Promise<BulkResult> {
  const isActive = input.action === 'ENABLE';

  const services = await prisma.service.findMany({
    where: { id: { in: input.ids } },
    select: { id: true, name: true },
  });
  const foundIds = new Set(services.map((s) => s.id));
  const notFound = input.ids.filter((id) => !foundIds.has(id));

  // Only the rows of the ONE requested charging type are ever loaded, so the
  // other two options of every selected service cannot be written even by a
  // bug in the update below.
  const optionRows = services.length
    ? await prisma.serviceOption.findMany({
        where: { serviceId: { in: services.map((s) => s.id) }, charging: input.charging },
        select: {
          id: true,
          serviceId: true,
          budgetMinPaise: true,
          budgetMaxPaise: true,
        },
      })
    : [];
  const optionByService = new Map(optionRows.map((o) => [o.serviceId, o]));

  const skipped: Array<{ name: string; reason: string }> = [];
  const updatableIds: string[] = [];

  for (const service of services) {
    const option = optionByService.get(service.id);
    if (!option) {
      skipped.push({
        name: service.name,
        reason: `The service has no ${CHARGING_LABEL[input.charging]} record.`,
      });
      continue;
    }

    // The same guard as `setChargingOption`, applied per row so that one
    // unbounded service never blocks the rest of the batch.
    if (
      input.charging === 'CUSTOMER_BUDGET' &&
      isActive &&
      (option.budgetMinPaise == null || option.budgetMaxPaise == null)
    ) {
      skipped.push({
        name: service.name,
        reason: 'No budget range is set. Set the minimum and maximum before enabling Customer Budget.',
      });
      continue;
    }
    updatableIds.push(option.id);
  }

  const { count } = updatableIds.length
    ? await prisma.serviceOption.updateMany({
        where: { id: { in: updatableIds } },
        data: { isActive },
      })
    : { count: 0 };

  await audit({
    action: 'CHARGING_OPTION_BULK_CHANGED',
    entityType: 'ServiceOption',
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      charging: input.charging,
      action: input.action,
      requested: input.ids.length,
      affected: count,
      notFound: notFound.length,
      skipped: skipped.length,
    },
  });

  return { requested: input.ids.length, affected: count, notFound, skipped };
}

// ---------------------------------------------------------------------------
// Bulk edit / delete / create
// ---------------------------------------------------------------------------

/**
 * Edits the supported, non-identity fields of several services at once.
 *
 * SAFETY: only `serviceType`, `description` and `includedWork` are writable,
 * and only the fields actually present in the patch. `Booking.serviceType` is a
 * snapshot taken at booking time and no booking stores a description, so this
 * can never rewrite an agreed quote or orphan a booking. Name, slug, placement
 * and price are unreachable from here.
 */
export async function bulkEditServices(
  input: z.infer<typeof adminServiceBulkSchema>,
  actor: AdminActor,
): Promise<BulkResult> {
  const patch = input.patch ?? {};
  const data: { serviceType?: ServiceType; description?: string | null; includedWork?: string | null } = {};
  const fields: string[] = [];
  if (patch.serviceType !== undefined) {
    data.serviceType = patch.serviceType;
    fields.push('serviceType');
  }
  // An explicitly empty string clears the optional copy; absence leaves it as-is.
  if (patch.description !== undefined) {
    data.description = patch.description.length > 0 ? patch.description : null;
    fields.push('description');
  }
  if (patch.includedWork !== undefined) {
    data.includedWork = patch.includedWork.length > 0 ? patch.includedWork : null;
    fields.push('includedWork');
  }

  const { existingIds, notFound } = await partitionExisting(input.ids, (existingIds) =>
    prisma.service.findMany({ where: { id: { in: existingIds } }, select: { id: true } }),
  );

  const { count } = await prisma.service.updateMany({
    where: { id: { in: existingIds } },
    data,
  });

  await audit({
    action: 'SERVICE_BULK_EDITED',
    entityType: 'Service',
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      requested: input.ids.length,
      affected: count,
      notFound: notFound.length,
      fields: fields.join(','),
    },
  });

  return { requested: input.ids.length, affected: count, notFound };
}

/**
 * Deletes several services at once, with hard booking-history protection.
 *
 * DATA INTEGRITY: a service referenced by ANY booking is NEVER deleted. The
 * `Booking.service` relation is `onDelete: Restrict`, so such a delete would be
 * rejected by the database anyway - this checks up front so the operator gets a
 * clear, per-record explanation instead of an opaque constraint error. Only
 * services with zero bookings are removed; their charging options, provider
 * links and reviews cascade, which is correct because the service no longer
 * exists. The result reports exactly which records were protected and why, so
 * nothing is ever removed silently.
 */
export async function bulkDeleteServices(
  input: z.infer<typeof adminServiceBulkSchema>,
  actor: AdminActor,
): Promise<BulkResult> {
  const services = await prisma.service.findMany({
    where: { id: { in: input.ids } },
    select: { id: true, name: true, _count: { select: { bookings: true } } },
  });

  const foundIds = new Set(services.map((s) => s.id));
  const notFound = input.ids.filter((id) => !foundIds.has(id));

  const deletableIds = services.filter((s) => s._count.bookings === 0).map((s) => s.id);
  const protectedRecords = services
    .filter((s) => s._count.bookings > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      reason: `Referenced by ${s._count.bookings} existing booking${s._count.bookings === 1 ? '' : 's'}`,
    }));

  let deleted = 0;
  if (deletableIds.length > 0) {
    const [result] = await prisma.$transaction([
      prisma.service.deleteMany({ where: { id: { in: deletableIds } } }),
    ]);
    deleted = result.count;
  }

  await audit({
    action: 'SERVICE_BULK_DELETED',
    entityType: 'Service',
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      requested: input.ids.length,
      deleted,
      protected: protectedRecords.length,
      notFound: notFound.length,
    },
  });

  return {
    requested: input.ids.length,
    affected: deleted,
    notFound,
    protected: protectedRecords,
  };
}

// ---------------------------------------------------------------------------
// Published pricing
// ---------------------------------------------------------------------------

/** The three states an operator can meaningfully distinguish in the UI. */
export type PricingState = 'PUBLISHED' | 'UNPUBLISHED' | 'DISABLED';

export function pricingStateOf(option: {
  isActive: boolean;
  pricePaise: number | null;
}): PricingState {
  if (!option.isActive) return 'DISABLED';
  return option.pricePaise == null ? 'UNPUBLISHED' : 'PUBLISHED';
}

export type AdminPricingQuery = {
  q?: string;
  category?: string;
  state: 'ALL' | PricingState;
  charging: 'ALL' | ChargingOption;
  page: number;
  pageSize: number;
};

function pricingWhere(query: AdminPricingQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (query.state === 'PUBLISHED') {
    where.isActive = true;
    where.pricePaise = { not: null };
  }
  if (query.state === 'UNPUBLISHED') {
    where.isActive = true;
    where.pricePaise = null;
  }
  if (query.state === 'DISABLED') where.isActive = false;
  if (query.charging !== 'ALL') where.charging = query.charging;
  if (query.q) where.service = { name: { contains: query.q } };
  if (query.category) where.service = { subCategory: { category: { slug: query.category } } };
  return where;
}

export async function listAdminPricing(query: AdminPricingQuery) {
  const where = pricingWhere(query);

  const [rows, total] = await Promise.all([
    prisma.serviceOption.findMany({
      where,
      orderBy: [{ service: { name: 'asc' } }, { charging: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        serviceId: true,
        charging: true,
        pricePaise: true,
        budgetMinPaise: true,
        budgetMaxPaise: true,
        isActive: true,
        service: {
          select: {
            name: true,
            slug: true,
            isActive: true,
            subCategory: {
              select: { name: true, category: { select: { name: true, slug: true } } },
            },
          },
        },
      },
    }),
    prisma.serviceOption.count({ where }),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    serviceId: r.serviceId,
    charging: r.charging,
    pricePaise: r.pricePaise,
    budgetMinPaise: r.budgetMinPaise,
    budgetMaxPaise: r.budgetMaxPaise,
    isActive: r.isActive,
    serviceName: r.service.name,
    serviceSlug: r.service.slug,
    serviceActive: r.service.isActive,
    categoryName: r.service.subCategory.category.name,
    categorySlug: r.service.subCategory.category.slug,
    subCategoryName: r.service.subCategory.name,
  }));

  return { items, total, page: query.page, pageSize: query.pageSize };
}
/**
 * Publishes or withdraws a published price for ONE charging option.
 *
 * CONTRACTUAL SAFETY:
 *  - Only `ServiceOption` is written. Bookings carry their own price snapshot
 *    and are never read or updated here, so a price change cannot retroactively
 *    alter an agreed quote.
 *  - Publishing requires the option to be ENABLED, so a customer can never be
 *    shown a price for a mode that `resolveBookingPricing` will reject as
 *    unavailable.
 *  - CUSTOMER_BUDGET may not carry a fixed price. In that mode the customer
 *    states a budget and the provider confirms scope; the booking domain
 *    deliberately returns `quotedPaise: null`. Publishing a figure here would
 *    advertise a number that can never be quoted.
 */
export async function setPublishedPrice(
  optionId: string,
  input: z.infer<typeof adminPriceSchema>,
  actor: AdminActor,
): Promise<{ id: string; pricePaise: number | null; isActive: boolean }> {
  const current = await prisma.serviceOption.findUnique({
    where: { id: optionId },
    select: {
      id: true,
      charging: true,
      pricePaise: true,
      isActive: true,
      service: { select: { id: true, isActive: true } },
    },
  });
  if (!current) throw notFound('Pricing option');

  if (current.charging === 'CUSTOMER_BUDGET') {
    throw new ApiError(
      'PRICE_NOT_APPLICABLE',
      'Customer Budget is quoted by scope, not by a fixed published price',
      422,
    );
  }

  const publishing = input.action === 'PUBLISH';

  if (publishing && input.pricePaise == null) {
    throw new ApiError('VALIDATION_ERROR', 'Enter a price to publish', 422);
  }

  if (publishing && !current.isActive) {
    throw new ApiError(
      'OPTION_DISABLED',
      'Enable this charging option before publishing a price for it',
      409,
    );
  }

  if (publishing && !current.service.isActive) {
    throw new ApiError('SERVICE_INACTIVE', 'Enable the service before publishing a price', 409);
  }

  const nextPrice = publishing ? (input.pricePaise as number) : null;

  const updated = await prisma.serviceOption.update({
    where: { id: optionId },
    // `pricePaise` is assigned explicitly from the validated server value. It
    // is never spread from the request body, so no additional field can be
    // written through this call.
    data: { pricePaise: nextPrice },
    select: { id: true, pricePaise: true, isActive: true },
  });

  // Counting affected bookings is a READ, purely so the audit metadata records
  // the blast radius of the change. The bookings themselves are untouched.
  const affectedBookings = await prisma.booking.count({
    where: { serviceId: current.service.id, charging: current.charging, quotedPaise: { not: null } },
  });

  await audit({
    action: publishing ? 'PRICE_PUBLISHED' : 'PRICE_UNPUBLISHED',
    entityType: 'ServiceOption',
    entityId: optionId,
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      charging: current.charging,
      serviceId: current.service.id,
      previousPricePaise: current.pricePaise,
      pricePaise: nextPrice,
      // Recorded explicitly: historical quotes are NOT rewritten.
      historicalBookingsUnchanged: affectedBookings,
    },
  });

  return updated;
}

/**
 * Creates one or more services under an existing subcategory.
 *
 * The slug is derived server-side and checked for collisions up front, so a
 * duplicate name is reported as a skipped item rather than surfacing as a raw
 * unique-constraint error. Each service is created with its three charging
 * options disabled and unpriced - exactly as the seed does - because publishing
 * a price is a separate, separately-audited commercial decision. Creation is a
 * single transaction, so a valid batch is all-or-nothing.
 */
export async function bulkCreateServices(
  input: z.infer<typeof adminServiceCreateSchema>,
  actor: AdminActor,
): Promise<BulkResult> {
  const subIds = Array.from(new Set(input.services.map((s) => s.subCategoryId)));
  const subs = await prisma.subCategory.findMany({
    where: { id: { in: subIds } },
    select: { id: true },
  });
  const validSubIds = new Set(subs.map((s) => s.id));

  const candidateSlugs = input.services.map((s) => slugifyService(s.name));
  const existing = await prisma.service.findMany({
    where: { slug: { in: candidateSlugs } },
    select: { slug: true },
  });
  const takenSlugs = new Set(existing.map((s) => s.slug));

  type CreateItem = (typeof input.services)[number] & { slug: string };
  const toCreate: CreateItem[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const batchSlugs = new Set<string>();

  for (const [index, item] of input.services.entries()) {
    const slug = candidateSlugs[index] ?? '';
    if (!slug) {
      skipped.push({ name: item.name, reason: 'Name did not produce a valid slug' });
      continue;
    }
    if (!validSubIds.has(item.subCategoryId)) {
      skipped.push({ name: item.name, reason: 'The selected subcategory does not exist' });
      continue;
    }
    if (takenSlugs.has(slug) || batchSlugs.has(slug)) {
      skipped.push({ name: item.name, reason: 'A service with this name already exists' });
      continue;
    }
    batchSlugs.add(slug);
    toCreate.push({ ...item, slug });
  }

  let created: Array<{ id: string; name: string; slug: string }> = [];
  if (toCreate.length > 0) {
    created = await prisma.$transaction(
      toCreate.map((item) =>
        prisma.service.create({
          data: {
            subCategoryId: item.subCategoryId,
            name: item.name,
            slug: item.slug,
            serviceType: item.serviceType,
            description: item.description && item.description.length > 0 ? item.description : null,
            includedWork: item.includedWork && item.includedWork.length > 0 ? item.includedWork : null,
            isActive: item.isActive ?? true,
            // Three charging options, disabled and unpriced, matching the seed.
            options: {
              create: CHARGING_OPTIONS.map((charging) => ({ charging, isActive: false })),
            },
          },
          select: { id: true, name: true, slug: true },
        }),
      ),
    );
  }

  await audit({
    action: 'SERVICE_BULK_CREATED',
    entityType: 'Service',
    actorId: actor.id,
    actorRole: actor.role,
    metadata: {
      requested: input.services.length,
      created: created.length,
      skipped: skipped.length,
    },
  });

  return {
    requested: input.services.length,
    affected: created.length,
    notFound: [],
    skipped,
    created,
  };
}

/**
 * The category tree (category -> subcategories) for the "add services" dialog.
 *
 * Read from the database with an explicit projection so the picker lists real,
 * existing subcategories with their ids - a client never invents a placement.
 */
export async function listAdminCategoryTree() {
  return prisma.category.findMany({
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      subCategories: {
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true, isActive: true },
      },
    },
  });
}
