import { z } from 'zod';

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
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

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

export const updateProfileSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
    address: addressSchema.partial().optional(),
  })
  .strict();

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