import { z } from 'zod';
import { BOOKING_STATUSES, INVOICE_STATUSES } from './domain';

/**
 * CENTRAL VALIDATION SCHEMAS
 *
 * Every API route validates its input with these schemas before touching the
 * database. Client-side validation is treated purely as UX.
 *
 * Rules applied throughout:
 * - Length caps on every string to prevent oversized payloads and abuse.
 * - Allowlisted enums instead of free-form strings where possible.
 * - Numbers are bounded; money is integer paise.
 * - Strings are trimmed and control characters are rejected.
 */

/** Strips control characters that could corrupt logs or terminal output. */
const controlChars = /[\u0000-\u001F\u007F]/g;

const safeString = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((s) => s.replace(controlChars, ''))
    .refine((s) => s.length > 0, 'Required');

export const nameSchema = safeString(80);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

/**
 * Indian mobile number, normalized to 10 digits for storage.
 *
 * Accepts and strips a +91 / 91 country prefix, a leading 0 trunk prefix, and
 * common separators (space, dash, brackets, dots).
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .transform((v) => v.replace(/^(?:\+?91|0)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number');

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password is too long')
  .refine((v) => /[a-z]/.test(v), 'Include a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Include an uppercase letter')
  .refine((v) => /\d/.test(v), 'Include a number')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include a symbol')
  .refine((v) => !/(.)\1{3,}/.test(v), 'Avoid repeating the same character 4+ times');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or mobile number').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
});

/**
 * Registration input.
 *
 * `.strict()` is deliberate: any unexpected key - including `role` - causes the
 * whole payload to be rejected, so a client can never mass-assign its own
 * privilege level during sign-up.
 */
export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    referralCode: z.string().trim().max(32).optional(),
  })
  .strict()
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password').max(200),
  })
  .strict()
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * PERSONAL PROFILE UPDATE
 *
 * `.strict()` is load-bearing: any unexpected key - including `role`,
 * `email`, `isActive`, `passwordHash` - rejects the whole payload, so a
 * client can never mass-assign a privileged field. Email is deliberately
 * absent: there is no verified email-change flow, so it stays read-only.
 */
export const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .strict()
  .refine((d) => d.name !== undefined || d.phone !== undefined, {
    message: 'Nothing to update',
    path: ['name'],
  });

/**
 * SAVED ADDRESS UPDATE
 *
 * The CustomerAddress label identifies which address book this is (e.g.
 * "Home"); the caller cannot choose another user's row - identity comes from
 * the session. `.strict()` for the same mass-assignment reason as above.
 */
export const updateAddressSchema = z
  .object({
    label: safeString(40).optional(),
    line1: safeString(160).optional(),
    line2: safeString(160).optional().or(z.literal('')),
    area: safeString(80).optional(),
    city: safeString(80).optional(),
    state: safeString(80).optional(),
    pincode: pincodeSchema.optional(),
    landmark: safeString(120).optional().or(z.literal('')),
  })
  .strict()
  .refine(
    (d) =>
      d.label !== undefined ||
      d.line1 !== undefined ||
      d.line2 !== undefined ||
      d.area !== undefined ||
      d.city !== undefined ||
      d.state !== undefined ||
      d.pincode !== undefined ||
      d.landmark !== undefined,
    { message: 'Nothing to update', path: ['line1'] },
  );

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  line1: safeString(160),
  line2: safeString(160).optional().or(z.literal('')),
  area: safeString(80),
  city: safeString(80),
  state: safeString(80),
  pincode: pincodeSchema,
  landmark: safeString(120).optional().or(z.literal('')),
});

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export const CHARGING_OPTIONS = ['VISIT_CHARGE', 'FIXED_CHARGE', 'CUSTOMER_BUDGET'] as const;
export const BOOKING_MODES = ['INSTANT', 'LATER', 'SCHEDULED', 'EMERGENCY'] as const;
export const SERVICE_TYPES = [
  'REPAIR',
  'INSTALLATION',
  'UNINSTALLATION',
  'MAINTENANCE',
  'REPLACEMENT',
  'CUSTOMIZATION',
  'SPARE_PARTS',
  'SITE_VISIT',
  'CONSULTATION',
  'REMOTE_SUPPORT',
] as const;

/** Absolute ceiling for any customer-entered budget (₹1 crore in paise). */
export const BUDGET_CEILING_PAISE = 100_000_00;
export const BUDGET_FLOOR_PAISE = 100_00; // ₹100

export const createBookingSchema = z
  .object({
    serviceId: z.string().cuid('Invalid service'),
    charging: z.enum(CHARGING_OPTIONS),
    mode: z.enum(BOOKING_MODES),
    serviceType: z.enum(SERVICE_TYPES).optional(), // derived from service if omitted
    scheduledFor: z.coerce.date().optional(),
    budgetMin: z.coerce.number().int().min(BUDGET_FLOOR_PAISE).max(BUDGET_CEILING_PAISE).optional(),
    budgetMax: z.coerce.number().int().min(BUDGET_FLOOR_PAISE).max(BUDGET_CEILING_PAISE).optional(),
    address: addressSchema,
    contactName: nameSchema,
    contactPhone: phoneSchema,
    description: safeString(1500).optional().or(z.literal('')),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.charging === 'CUSTOMER_BUDGET') {
      if (data.budgetMin == null || data.budgetMax == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter both a minimum and maximum budget',
          path: ['budgetMin'],
        });
        return;
      }
      if (data.budgetMin > data.budgetMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Minimum budget cannot exceed maximum budget',
          path: ['budgetMax'],
        });
      }
      if (data.budgetMax - data.budgetMin < 5000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Budget range must be at least ₹50 wide',
          path: ['budgetMax'],
        });
      }
    }

    if (data.mode === 'SCHEDULED') {
      if (!data.scheduledFor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Choose a date and time for a scheduled booking',
          path: ['scheduledFor'],
        });
      } else {
        const min = new Date(Date.now() + 60 * 60 * 1000);
        const max = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);
        if (data.scheduledFor < min) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Scheduled time must be at least 1 hour from now',
            path: ['scheduledFor'],
          });
        } else if (data.scheduledFor > max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Bookings can be scheduled up to 90 days ahead',
            path: ['scheduledFor'],
          });
        }
      }
    }

    if (data.mode === 'LATER' && !data.scheduledFor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose when you would like the service',
        path: ['scheduledFor'],
      });
    }
  });

/**
 * Server-side price PREVIEW for the booking confirmation step.
 *
 * The confirmation screen must show what the provider has actually published
 * BEFORE the booking is created. This schema carries only the inputs needed to
 * resolve a price - it deliberately has no room for a client-supplied amount,
 * so a browser can never influence the figure that is displayed or stored.
 */
export const quoteSchema = z
  .object({
    serviceId: z.string().cuid('Invalid service'),
    charging: z.enum(CHARGING_OPTIONS),
    budgetMin: z.coerce.number().int().min(BUDGET_FLOOR_PAISE).max(BUDGET_CEILING_PAISE).optional(),
    budgetMax: z.coerce.number().int().min(BUDGET_FLOOR_PAISE).max(BUDGET_CEILING_PAISE).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.charging !== 'CUSTOMER_BUDGET') return;
    if (data.budgetMin == null || data.budgetMax == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter both a minimum and maximum budget',
        path: ['budgetMin'],
      });
      return;
    }
    if (data.budgetMin > data.budgetMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum budget cannot exceed maximum budget',
        path: ['budgetMax'],
      });
    }
  });

/**
 * Booking transition request. The client names a DESIRED next status; the
 * server re-validates it against the state machine and the actor's role.
 */
export const bookingTransitionSchema = z
  .object({
    nextStatus: z.enum([
      'CONFIRMED',
      'TECHNICIAN_ASSIGNED',
      'TECHNICIAN_ON_THE_WAY',
      'ARRIVED',
      'SERVICE_IN_PROGRESS',
      'COMPLETED',
      'INVOICE_GENERATED',
      'PAYMENT_PENDING',
      'FEEDBACK_PENDING',
      'CLOSED',
      'CANCELLED',
    ]),
    note: safeString(500).optional().or(z.literal('')),
    technicianId: z.string().cuid().optional(),
  })
  .strict();

export const assignTechnicianSchema = z
  .object({ technicianId: z.string().cuid('Invalid technician') })
  .strict();

export const reviewSchema = z
  .object({
    bookingId: z.string().cuid('Invalid booking'),
    rating: z.coerce.number().int().min(1, 'Select a rating').max(5),
    comment: safeString(1000).optional().or(z.literal('')),
  })
  .strict();

// ---------------------------------------------------------------------------
// Material orders
// ---------------------------------------------------------------------------

export const materialOrderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            materialId: z.string().cuid('Invalid item'),
            quantity: z.coerce.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1, 'Your cart is empty')
      .max(50, 'Too many distinct items in one order'),
    address: addressSchema,
    contactName: nameSchema,
    contactPhone: phoneSchema,
    installationRequested: z.boolean().default(false),
  })
  .strict();

// ---------------------------------------------------------------------------
// Support / profile
// ---------------------------------------------------------------------------

export const supportThreadSchema = z.object({
  subject: safeString(120),
  body: safeString(3000),
});

export const supportReplySchema = z.object({
  threadId: z.string().cuid(),
  body: safeString(3000),
});

export const referralRedeemSchema = z.object({ code: z.string().trim().min(4).max(32) }).strict();

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminUserUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    isActive: z.boolean().optional(),
    role: z.enum(['CUSTOMER', 'PROVIDER', 'TECHNICIAN', 'ADMIN']).optional(),
  })
  .strict();

export const adminProviderUpdateSchema = z
  .object({
    displayName: safeString(120).optional(),
    description: safeString(1000).optional().or(z.literal('')),
    contactEmail: emailSchema.optional().or(z.literal('')),
    contactPhone: phoneSchema.optional().or(z.literal('')),
    whatsappNumber: phoneSchema.optional().or(z.literal('')),
    registeredAddress: safeString(300).optional().or(z.literal('')),
    serviceAreaCities: safeString(200).optional().or(z.literal('')),
    isActive: z.boolean().optional(),
    isVerified: z.boolean().optional(),
  })
  .strict();

export const adminTechnicianUpdateSchema = z
  .object({
    displayName: safeString(120).optional(),
    headline: safeString(160).optional().or(z.literal('')),
    skills: safeString(300).optional().or(z.literal('')),
    isActive: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
  })
  .strict();

export const adminOrderUpdateSchema = z
  .object({
    status: z.enum([
      'PLACED',
      'CONFIRMED',
      'PACKED',
      'DISPATCHED',
      'DELIVERED',
      'CANCELLED',
      'INSTALLATION_SCHEDULED',
      'INSTALLATION_COMPLETED',
    ]),
    note: safeString(500).optional().or(z.literal('')),
  })
  .strict();

export const adminSettingSchema = z.object({ key: safeString(80), value: safeString(2000) }).strict();

// ---------------------------------------------------------------------------
// Catalog administration (categories, services, charging options, pricing)
//
// EVERY schema here is `.strict()`. That is the mass-assignment control: an
// unexpected key - `role`, `isActive` on the wrong endpoint, `serviceId`,
// `slug` - rejects the entire request instead of being silently dropped. The
// schemas also deliberately expose ONLY the fields that are commercially
// editable. Fields that are authoritative and must not drift (Category.name,
// Category.code, Category.position, Service.slug, Service.serviceType) are
// absent, so they cannot be posted even if a caller tries.
//
// The target row is taken from the URL path, never from the body, so a body
// cannot redirect a mutation at a different record.
// ---------------------------------------------------------------------------

/** Absolute ceiling for a published price (₹1 crore), matching the budget bound. */
export const PRICE_CEILING_PAISE = BUDGET_CEILING_PAISE;

/**
 * Category status. The 20 official categories keep their authoritative names;
 * only availability is operationally changeable.
 */
export const adminCategoryStatusSchema = z.object({ isActive: z.boolean() }).strict();

/** Service activation. Name, slug, type and catalogue placement are read-only. */
export const adminServiceStatusSchema = z.object({ isActive: z.boolean() }).strict();

// ---------------------------------------------------------------------------
// Bulk catalogue administration
// ---------------------------------------------------------------------------

/**
 * A bounded, de-duplicated list of record ids for a bulk operation.
 *
 * Ids are validated as cuid so a malformed value is rejected at the boundary
 * rather than reaching a Prisma `where`. The list is capped so a single request
 * cannot drive an unbounded mass mutation, and de-duplicated so the same record
 * is never processed twice within one operation.
 */
const bulkIdList = (label: string) =>
  z
    .array(z.string().cuid(`Invalid ${label} id`))
    .min(1, `Select at least one ${label}`)
    .max(200, `Select at most 200 ${label}s at once`)
    .transform((ids) => Array.from(new Set(ids)));

/** Optional free-text field for a bulk edit; empty/absent means "leave unchanged". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((s) => s.replace(controlChars, ''))
    .optional();

/**
 * Bulk operation over services: activate, deactivate, edit or delete.
 *
 * The payload is `.strict()` so no field outside this contract - `id`, `role`,
 * `pricePaise`, a category id - can be smuggled in to redirect or enrich the
 * mutation. `EDIT` must carry at least one editable field; every other action
 * must NOT carry a patch, so an activate can never silently rewrite copy.
 *
 * WHICH FIELDS ARE EDITABLE, AND WHY THESE: `serviceType`, `description` and
 * `includedWork` are non-identity, non-relational attributes. Editing them can
 * never orphan a booking: `Booking.serviceType` is a snapshot taken at booking
 * time, and no booking stores a service's description. Name, slug, catalogue
 * placement and price are deliberately absent - name/slug are identity, price
 * has its own separately-audited endpoint.
 */
export const adminServiceBulkSchema = z
  .object({
    ids: bulkIdList('service'),
    action: z.enum(['ACTIVATE', 'DEACTIVATE', 'DELETE', 'EDIT']),
    patch: z
      .object({
        serviceType: z.enum(SERVICE_TYPES).optional(),
        description: optionalText(1000),
        includedWork: optionalText(2000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const patch = data.patch;
    const hasPatch =
      !!patch && (patch.serviceType !== undefined || patch.description !== undefined || patch.includedWork !== undefined);
    if (data.action === 'EDIT' && !hasPatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose at least one field to update',
        path: ['patch'],
      });
    }
    if (data.action !== 'EDIT' && patch !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A patch is only allowed with the EDIT action',
        path: ['patch'],
      });
    }
  });

/**
 * Bulk operation over the 20 official categories.
 *
 * ONLY activation is offered. Name, code, position and description are the
 * authoritative official catalogue identity and are absent from the schema, so
 * `.strict()` rejects any attempt to rename, reorder or - critically - DELETE an
 * official category in bulk. Deactivating hides a category from customers while
 * preserving every record and all booking history.
 */
export const adminCategoryBulkSchema = z
  .object({
    ids: bulkIdList('category'),
    action: z.enum(['ACTIVATE', 'DEACTIVATE']),
  })
  .strict();

/** One new service in a bulk-create request. */
export const adminServiceCreateItemSchema = z
  .object({
    subCategoryId: z.string().cuid('Invalid subcategory'),
    name: nameSchema,
    serviceType: z.enum(SERVICE_TYPES),
    description: optionalText(1000),
    includedWork: optionalText(2000),
    isActive: z.boolean().optional(),
  })
  .strict();

/**
 * Bulk create: add one or more services under an existing subcategory.
 *
 * Each item carries the fields the schema actually requires (`subCategoryId`,
 * `name`, `serviceType`); `slug` is derived server-side and the three charging
 * options are created disabled with no price, exactly as the seed does - a price
 * is a commercial decision published through its own audited endpoint, never
 * fabricated here.
 */
export const adminServiceCreateSchema = z
  .object({
    services: z
      .array(adminServiceCreateItemSchema)
      .min(1, 'Add at least one service')
      .max(50, 'Add at most 50 services at once'),
  })
  .strict();

/**
 * Charging-option configuration.
 *
 * Budget bounds apply only to CUSTOMER_BUDGET; the server re-checks that
 * against the row's actual `charging` value before writing. `pricePaise` is
 * intentionally NOT here - publishing a price is a separate, separately
 * audited action (see `adminPriceSchema`) so that enabling an option can
 * never implicitly expose a price.
 */
export const adminChargingOptionSchema = z
  .object({
    isActive: z.boolean(),
    budgetMinPaise: z.coerce
      .number()
      .int()
      .min(BUDGET_FLOOR_PAISE, 'Budget minimum is below the permitted floor')
      .max(BUDGET_CEILING_PAISE, 'Budget minimum is above the permitted ceiling')
      .nullable()
      .optional(),
    budgetMaxPaise: z.coerce
      .number()
      .int()
      .min(BUDGET_FLOOR_PAISE, 'Budget maximum is below the permitted floor')
      .max(BUDGET_CEILING_PAISE, 'Budget maximum is above the permitted ceiling')
      .nullable()
      .optional(),
    durationMinMinutes: z.coerce.number().int().min(5).max(1440).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const min = data.budgetMinPaise;
    const max = data.budgetMaxPaise;
    // Null/undefined on one side means "fall back to the platform default", so
    // only a pair that is actually present is range-checked here. The server
    // still re-validates against the row's charging type before writing.
    if (min == null || max == null) return;
    if (min > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Budget minimum cannot exceed budget maximum',
        path: ['budgetMaxPaise'],
      });
      return;
    }
    if (max - min < 5000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Budget range must be at least Rs 50 wide',
        path: ['budgetMaxPaise'],
      });
    }
  });

/**
 * Bulk operation over charging options: enable or disable ONE charging type
 * across several services.
 *
 * The payload is `.strict()` so nothing outside this contract - a price, a
 * budget bound, a duration - can be smuggled in. Only `isActive` of the single
 * named charging type is ever written; the other two options of every selected
 * service carry no data here and carry no column in the write, so a bulk Visit
 * Charge operation cannot touch a Fixed Charge or Customer Budget row and vice
 * versa. The server additionally re-validates each row against its real
 * charging type (enabling Customer Budget requires a configured range) and
 * reports any row it had to skip instead of failing the whole batch.
 */
export const adminChargingBulkSchema = z
  .object({
    ids: bulkIdList('service'),
    charging: z.enum(CHARGING_OPTIONS),
    action: z.enum(['ENABLE', 'DISABLE']),
  })
  .strict();

/**
 * Price publication / withdrawal.
 *
 * The intent is explicit so there is no ambiguous "pricePaise: null means
 * delete" semantics, and the amount is a bounded integer of paise - never a
 * float, never a client-formatted string.
 */
export const adminPriceSchema = z
  .object({
    action: z.enum(['PUBLISH', 'UNPUBLISH']),
    pricePaise: z.coerce
      .number()
      .int('Price must be a whole number of paise')
      .min(100, 'Price must be at least Rs 1')
      .max(PRICE_CEILING_PAISE, 'Price is above the permitted ceiling')
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.action === 'PUBLISH' && data.pricePaise == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a price to publish',
        path: ['pricePaise'],
      });
    }
    // Refuse a withdrawal that also carries a figure: the two contradict, and
    // silently ignoring one of them would make the audit trail a lie.
    if (data.action === 'UNPUBLISH' && data.pricePaise != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Do not send a price when unpublishing',
        path: ['pricePaise'],
      });
    }
  });

/** Query parameters for the admin service table. */
export const adminServiceQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .transform((s) => s.replace(controlChars, ''))
      .optional(),
    category: z.string().trim().max(64).optional(),
    status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ALL'),
    charging: z.enum(['ALL', ...CHARGING_OPTIONS]).default('ALL'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** Query parameters for the unified charging-options table (one row per service). */
export const adminChargingServiceQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .transform((s) => s.replace(controlChars, ''))
      .optional(),
    category: z.string().trim().max(64).optional(),
    /**
     * Which charging option must be enabled on the service:
     * ALL = no constraint, otherwise the matching `ServiceOption` must be active.
     */
    charging: z.enum(['ALL', ...CHARGING_OPTIONS]).default('ALL'),
    /**
     * Enabled-state constraint, evaluated across the service's three options:
     * ALL = no constraint, ENABLED = at least one option on, DISABLED = none on.
     */
    status: z.enum(['ALL', 'ENABLED', 'DISABLED']).default('ALL'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** Query parameters for the admin pricing table. */
export const adminPricingQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .transform((s) => s.replace(controlChars, ''))
      .optional(),
    category: z.string().trim().max(64).optional(),
    /** ALL | PUBLISHED | UNPUBLISHED | DISABLED */
    state: z.enum(['ALL', 'PUBLISHED', 'UNPUBLISHED', 'DISABLED']).default('ALL'),
    charging: z.enum(['ALL', ...CHARGING_OPTIONS]).default('ALL'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/**
 * Query parameters for the admin bookings table.
 *
 * `.strict()` rejects an unrecognised parameter rather than forwarding it into
 * a database filter. `status` is an allowlist - the canonical
 * `BOOKING_STATUSES` from `src/lib/domain.ts` plus `ALL` - so a free-form
 * string can never reach the query, and `page` / `pageSize` are bounded
 * integers so one request cannot ask for an unbounded scan.
 */
export const adminBookingQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .transform((s) => s.replace(controlChars, ''))
      .optional(),
    /** ALL = no status constraint; otherwise exactly one canonical status. */
    status: z.enum(['ALL', ...BOOKING_STATUSES]).default('ALL'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** Body for confirming a booking. No fields - the server resolves the target state. */
export const adminConfirmBookingSchema = z.object({}).strict();

/** Body for assigning a technician. Only the technician id may be supplied. */
export const adminAssignTechnicianSchema = z
  .object({
    technicianId: z.string().trim().min(1, 'Select a technician'),
  })
  .strict();

/**
 * Query parameters for the admin invoice table.
 *
 * `.strict()` rejects an unrecognised parameter rather than forwarding it into a
 * database filter, and `status` is the canonical invoice-status allowlist plus
 * `ALL`. Page bounds stop a single request from asking for an unbounded scan.
 */
export const adminInvoiceQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .transform((s) => s.replace(controlChars, ''))
      .optional(),
    /** ALL = no status constraint; otherwise exactly one canonical status. */
    status: z.enum(['ALL', ...INVOICE_STATUSES]).default('ALL'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/**
 * Body for issuing an invoice.
 *
 * No fields are accepted, and `.strict()` means any attempt to supply an amount,
 * a price, a tax rate or a line item rejects the whole request. Every figure is
 * resolved from the persisted booking.
 */
export const adminGenerateInvoiceSchema = z.object({}).strict();

// ---------------------------------------------------------------------------
// Shared query params
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Search term: bounded and stripped of anything that could break rendering. */
export const searchSchema = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .transform((s) => s.replace(controlChars, ''))
    .optional(),
});