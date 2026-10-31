/**
 * CANONICAL DOMAIN CONSTANTS
 *
 * WHY STRINGS INSTEAD OF DATABASE ENUMS:
 * The development database is SQLite, which Prisma cannot create native enums
 * for. To keep strong typing without weakening the model, every "enum" column
 * is a String constrained to exactly these values:
 *   - TypeScript types it at compile time,
 *   - Zod validates it at the API boundary (allowlist, never a free string),
 *   - the server re-validates before every write.
 *
 * FOR PRODUCTION: switch the Prisma datasource provider to `postgresql` and
 * these can be promoted to native `enum` blocks for database-level enforcement.
 * The values below are the single source of truth either way.
 */

export const ROLES = ['CUSTOMER', 'PROVIDER', 'TECHNICIAN', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const BOOKING_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'TECHNICIAN_ASSIGNED',
  'TECHNICIAN_ON_THE_WAY',
  'ARRIVED',
  'SERVICE_IN_PROGRESS',
  'COMPLETED',
  'INVOICE_GENERATED',
  'PAYMENT_PENDING',
  'PAID',
  'FEEDBACK_PENDING',
  'CLOSED',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const CHARGING_OPTIONS = ['VISIT_CHARGE', 'FIXED_CHARGE', 'CUSTOMER_BUDGET'] as const;
export type ChargingOption = (typeof CHARGING_OPTIONS)[number];

export const BOOKING_MODES = ['INSTANT', 'LATER', 'SCHEDULED', 'EMERGENCY'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

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
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID', 'OVERDUE'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Payment lifecycle. Every value maps to something the gateway actually
 * reports - nothing is staged for appearance:
 *
 *   CREATED           an attempt row exists; no gateway order yet
 *   PENDING           a gateway order exists and checkout may be completed
 *   AUTHORIZED        the bank approved it but the gateway has not captured it
 *   CAPTURED          the gateway captured the money - the only payable state
 *   FAILED            the gateway reported a failed attempt
 *   REFUNDED          the full captured amount was refunded
 *   PARTIALLY_REFUNDED part of the captured amount was refunded
 *
 * A browser callback NEVER moves a payment to CAPTURED; only a server-side
 * gateway check or a signature-verified webhook does.
 */
export const PAYMENT_STATUSES = [
  'CREATED',
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = [
  'PLACED',
  'CONFIRMED',
  'PACKED',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
  'INSTALLATION_SCHEDULED',
  'INSTALLATION_COMPLETED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const MATERIAL_ORDER_KINDS = ['MATERIAL', 'INSTALLATION'] as const;
export type MaterialOrderKind = (typeof MATERIAL_ORDER_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'READ'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const MESSAGE_THREAD_STATUSES = ['OPEN', 'PENDING', 'CLOSED'] as const;
export type MessageThreadStatus = (typeof MESSAGE_THREAD_STATUSES)[number];

export const REFERRAL_STATUSES = ['PENDING', 'QUALIFIED', 'CREDITED', 'EXPIRED', 'REJECTED'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'LOGOUT_ALL',
  'PASSWORD_CHANGED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_SUSPENDED',
  'ROLE_CHANGED',
  'PROVIDER_UPDATED',
  'TECHNICIAN_ASSIGNED',
  /**
   * Technician operations. Creation, profile edits, activation state and
   * availability are distinct events: an operator asking "who took this
   * technician off the roster, and when?" must not have to reconstruct it from
   * one generic update row.
   *
   * `TECHNICIAN_JOB_STATUS_CHANGED` is reserved for the dispatch-transition
   * milestone; nothing emits it yet.
   */
  'TECHNICIAN_CREATED',
  'TECHNICIAN_UPDATED',
  'TECHNICIAN_STATUS_CHANGED',
  'TECHNICIAN_AVAILABILITY_CHANGED',
  'TECHNICIAN_ACCOUNT_PROVISIONED',
  'TECHNICIAN_ACCOUNT_ACTIVATED',
  'TECHNICIAN_ACCOUNT_DISABLED',
  'TECHNICIAN_FEATURES_CHANGED',
  'TECHNICIAN_JOB_STATUS_CHANGED',
  /**
   * One event per bulk roster operation. The individual outcomes are in the
   * metadata (action, requested, affected, skipped) rather than as N log rows, so
   * a 50-technician edit stays one auditable action by one actor.
   */
  'TECHNICIAN_BULK_CHANGED',
  /**
   * Catalog and commercial administration. These are deliberately distinct
   * actions rather than a generic "admin updated row": a price publication and
   * a price withdrawal are different events with different risk, and collapsing
   * them would make the log useless for reconstructing who changed what.
   */
  'CATEGORY_STATUS_CHANGED',
  'SERVICE_STATUS_CHANGED',
  'CATEGORY_BULK_STATUS_CHANGED',
  'SERVICE_BULK_STATUS_CHANGED',
  'SERVICE_BULK_EDITED',
  'SERVICE_BULK_DELETED',
  'SERVICE_BULK_CREATED',
  'CHARGING_OPTION_CHANGED',
  'CHARGING_OPTION_BULK_CHANGED',
  'PRICE_PUBLISHED',
  'PRICE_UNPUBLISHED',
  'BOOKING_CREATED',
  'BOOKING_CONFIRMED',
  'BOOKING_STATUS_CHANGED',
  'BOOKING_CANCELLED',
  'ATTACHMENT_UPLOADED',
  'INVOICE_CREATED',
  'INVOICE_MODIFIED',
  'PAYMENT_INITIATED',
  'PAYMENT_STATUS_CHANGED',
  'PAYMENT_VERIFICATION_FAILED',
  'MATERIAL_ORDER_CREATED',
  'MATERIAL_ORDER_STATUS_CHANGED',
  'SETTINGS_CHANGED',
  'ACCESS_DENIED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// --- Human-readable labels --------------------------------------------------

export const CHARGING_LABEL: Record<ChargingOption, string> = {
  VISIT_CHARGE: 'Visit Charge',
  FIXED_CHARGE: 'Fixed Charge',
  CUSTOMER_BUDGET: 'Customer Budget',
};

/** Neutral, honest explanation of each charging option. */
export const CHARGING_HINT: Record<ChargingOption, string> = {
  VISIT_CHARGE:
    'A visit charge applies for the technician visit. The final work cost is confirmed after inspection.',
  FIXED_CHARGE: 'A fixed price applies for this service as published by the provider.',
  CUSTOMER_BUDGET:
    'Share the budget you have in mind. The provider confirms what can be delivered within it.',
};

export const MODE_LABEL: Record<BookingMode, string> = {
  INSTANT: 'Instant',
  LATER: 'Later',
  SCHEDULED: 'Scheduled',
  EMERGENCY: 'Emergency',
};

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  REPAIR: 'Repair',
  INSTALLATION: 'Installation',
  UNINSTALLATION: 'Uninstallation',
  MAINTENANCE: 'Maintenance',
  REPLACEMENT: 'Replacement',
  CUSTOMIZATION: 'Customization / Setup',
  SPARE_PARTS: 'Spare Parts',
  SITE_VISIT: 'Site Visit',
  CONSULTATION: 'Consultation / Advisory',
  REMOTE_SUPPORT: 'Live Chat / Remote Support',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  INSTALLATION_SCHEDULED: 'Installation scheduled',
  INSTALLATION_COMPLETED: 'Installation completed',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  CREATED: 'Not started',
  PENDING: 'Payment pending',
  AUTHORIZED: 'Payment processing',
  CAPTURED: 'Paid',
  FAILED: 'Payment failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PAID: 'Paid',
  VOID: 'Void',
  OVERDUE: 'Overdue',
};

export const ROLE_LABEL: Record<Role, string> = {
  CUSTOMER: 'Customer',
  PROVIDER: 'Provider',
  TECHNICIAN: 'Technician',
  ADMIN: 'Administrator',
};

/**
 * Narrows an arbitrary string to a Role.
 *
 * CRITICAL: any value read from the database and then used for an authorization
 * decision MUST pass through this. Never assume stored data is well-formed.
 */
export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Narrows an arbitrary string to a BookingStatus. */
export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

/**
 * Narrows an arbitrary string to a ChargingOption, defaulting to VISIT_CHARGE
 * which is the most conservative interpretation.
 */
export function toChargingOption(value: string): ChargingOption {
  return (CHARGING_OPTIONS as readonly string[]).includes(value)
    ? (value as ChargingOption)
    : 'VISIT_CHARGE';
}