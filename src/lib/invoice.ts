import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { audit } from './audit';
import { ApiError } from './api';
import { INVOICE_STATUS_LABEL, CHARGING_LABEL, toChargingOption, isBookingStatus, type InvoiceStatus } from './domain';
import { STATUS_LABEL, isTerminal } from './booking-state';
import type { InvoicePdfDocument } from './invoice-pdf';

/**
 * INVOICE DOMAIN
 *
 * SERVER-ONLY. Every figure an invoice contains is derived here from persisted
 * booking data; nothing is accepted from a browser.
 *
 * TWO DECISIONS WORTH THE WORDS:
 *
 * 1. ELIGIBILITY. The existing state machine (`src/lib/booking-state.ts`) has
 *    exactly one edge into invoicing - `COMPLETED -> INVOICE_GENERATED`, ADMIN
 *    only - and `STATUS_HINT.COMPLETED` already reads "the invoice is being
 *    generated". That is the point the domain establishes, so an invoice can
 *    only be issued for a booking in `COMPLETED`. It is NOT issued for
 *    REQUESTED/CONFIRMED/TECHNICIAN_ASSIGNED work in progress, nor for CLOSED,
 *    and no new booking status is introduced.
 *
 * 2. NO CONFIRMED AMOUNT, NO INVOICE. `CUSTOMER_BUDGET` bookings deliberately
 *    persist a budget RANGE with `quotedPaise = null`, because the provider
 *    confirms the scope separately. The domain never stores a final agreed
 *    figure, so generating an invoice would mean inventing one. Those bookings
 *    are refused with an explicit reason instead of being billed a guess.
 *
 * MONEY IS INTEGER PAISE THROUGHOUT. No floating-point arithmetic touches a
 * total: quantity is an integer, unit price is an integer, and a line total is
 * `unitPaise * quantity`. The subtotal is the integer sum of the line totals and
 * is asserted to reconcile before anything is written.
 */

/** Invoice numbers are sequential and year-scoped: SERIC-INV-2026-000001. */
export const INVOICE_NUMBER_PREFIX = 'SERIC-INV';

/** Only a completed job may be invoiced - the single `-> INVOICE_GENERATED` edge. */
export const INVOICE_ELIGIBLE_STATUSES = ['COMPLETED'] as const;

/**
 * Upper bound for a single invoice (₹1 crore, in paise).
 *
 * Not a business rule - a sanity bound on stored data, so a corrupted or
 * hand-edited row cannot produce a nonsense financial document.
 */
export const MAX_INVOICE_PAISE = 1_000_000_000;

/** No verified tax registration or rule exists, so no tax is ever applied. */
export const INVOICE_TAX_RATE_BPS = 0;

export type InvoiceLine = {
  description: string;
  charging: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
};

export type SellerSnapshot = {
  name: string;
  legalName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
};

export type CustomerSnapshot = {
  name: string;
  contactName: string;
  contactPhone: string;
  address: string;
};

// ---------------------------------------------------------------------------
// Eligibility (pure)
// ---------------------------------------------------------------------------

export type InvoiceSource = {
  status: string;
  charging: string;
  quotedPaise: number | null;
  /** True when this booking already has an invoice row. */
  hasInvoice: boolean;
  /** True when the booking still has a seller (provider) attached. */
  hasSeller: boolean;
};

export type InvoiceEligibility =
  | { eligible: true }
  | {
      eligible: false;
      code:
        | 'ALREADY_INVOICED'
        | 'NOT_COMPLETED'
        | 'NO_CONFIRMED_PRICE'
        | 'NO_SELLER'
        | 'AMOUNT_OUT_OF_RANGE';
      reason: string;
    };

/**
 * Decides whether an invoice may be issued for a booking.
 *
 * Pure, and used in three places on purpose - the admin page (to decide what to
 * render), the API (to enforce) and the tests - so the rule can never drift
 * between what is displayed and what is allowed.
 */
export function assessInvoiceEligibility(source: InvoiceSource): InvoiceEligibility {
  if (source.hasInvoice) {
    return {
      eligible: false,
      code: 'ALREADY_INVOICED',
      reason: 'An invoice has already been issued for this booking.',
    };
  }

  if (!(INVOICE_ELIGIBLE_STATUSES as readonly string[]).includes(source.status)) {
    // Narrow before using the status as a lookup key or for an authorization-ish
    // decision: stored data is never assumed well-formed.
    const known = isBookingStatus(source.status) ? source.status : null;
    const label = known ? STATUS_LABEL[known] : source.status;
    return {
      eligible: false,
      code: 'NOT_COMPLETED',
      reason: known && isTerminal(known)
        ? `This booking is ${label} and cannot be invoiced.`
        : `An invoice can only be issued once the work is marked complete. This booking is ${label}.`,
    };
  }

  if (!source.hasSeller) {
    return {
      eligible: false,
      code: 'NO_SELLER',
      reason: 'This booking has no provider attached, so there is no seller to bill from it.',
    };
  }

  const amount = source.quotedPaise;
  if (amount == null || amount <= 0) {
    return {
      eligible: false,
      code: 'NO_CONFIRMED_PRICE',
      reason:
        source.charging === 'CUSTOMER_BUDGET'
          ? 'This booking was placed against a customer budget, which stores a range rather than a final agreed amount. It cannot be invoiced until a final amount is recorded.'
          : 'No price is recorded against this booking, so there is nothing to invoice.',
    };
  }

  if (!Number.isSafeInteger(amount) || amount > MAX_INVOICE_PAISE) {
    return {
      eligible: false,
      code: 'AMOUNT_OUT_OF_RANGE',
      reason: 'The recorded price for this booking is not a usable invoice amount.',
    };
  }

  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Arithmetic (pure)
// ---------------------------------------------------------------------------

/**
 * Builds the single line item for a booking.
 *
 * One booking bills one service, so `quantity` is 1 and the unit price is the
 * server-resolved booking price. Both are snapshotted onto the invoice, so a
 * later catalogue change cannot alter an issued document.
 */
export function buildInvoiceLine(input: {
  serviceName: string;
  charging: string;
  quotedPaise: number;
}): InvoiceLine {
  const quantity = 1;

  if (!Number.isSafeInteger(input.quotedPaise) || input.quotedPaise <= 0) {
    throw new ApiError('INVALID_AMOUNT', 'The booking price is not a valid invoice amount', 422);
  }

  return {
    description: input.serviceName,
    charging: input.charging,
    quantity,
    unitPaise: input.quotedPaise,
    // Integer x integer: exact, no floating point.
    amountPaise: input.quotedPaise * quantity,
  };
}

export type InvoiceTotals = { subtotalPaise: number; taxPaise: number; totalPaise: number };

/**
 * Sums line totals into the invoice totals.
 *
 * Throws if a line total disagrees with `unitPrice * quantity` or if the lines do
 * not reconcile with the subtotal. That is a data or programming fault, never a
 * user error, so it fails loudly instead of printing a wrong invoice.
 */
export function calculateInvoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  let subtotalPaise = 0;

  for (const line of lines) {
    if (!Number.isSafeInteger(line.unitPaise) || line.unitPaise <= 0) {
      throw new ApiError('INVALID_AMOUNT', 'An invoice line has an invalid unit price', 422);
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new ApiError('INVALID_AMOUNT', 'An invoice line has an invalid quantity', 422);
    }
    if (line.amountPaise !== line.unitPaise * line.quantity) {
      throw new ApiError('INCONSISTENT_INVOICE', 'An invoice line total does not match its price', 422);
    }
    subtotalPaise += line.amountPaise;
  }

  if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise <= 0) {
    throw new ApiError('INCONSISTENT_INVOICE', 'The invoice subtotal is not a valid amount', 422);
  }

  // Tax is zero: no verified tax registration or rule is configured. Applying
  // GST here would fabricate a legal liability, so the rate is pinned to zero
  // and a test asserts it.
  const taxPaise = 0;

  return { subtotalPaise, taxPaise, totalPaise: subtotalPaise + taxPaise };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Joins the address parts that exist. Missing parts are omitted, not faked. */
export function joinAddress(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(', ');
}

export function buildSellerSnapshot(provider: {
  displayName: string;
  legalName: string;
  registeredAddress: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  gstin: string | null;
}): SellerSnapshot {
  return {
    name: provider.displayName,
    legalName: provider.legalName,
    address: provider.registeredAddress,
    email: provider.contactEmail,
    phone: provider.contactPhone,
    // Only what is configured is snapshotted. A blank registration stays blank;
    // it is never filled in with a placeholder.
    gstin: provider.gstin,
  };
}

export function buildCustomerSnapshot(booking: {
  contactName: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  area: string;
  city: string;
  state: string;
  pincode: string;
}): CustomerSnapshot {
  return {
    name: booking.contactName,
    contactName: booking.contactName,
    contactPhone: booking.contactPhone,
    address: joinAddress([
      booking.addressLine1,
      booking.addressLine2,
      booking.area,
      booking.city,
      booking.state,
      booking.pincode,
    ]),
  };
}

/**
 * Reads a stored snapshot back.
 *
 * Defensive by design: a row written by an older version, or a truncated string,
 * yields `{}` rather than throwing, so a historical invoice still renders with
 * whatever fields it has.
 */
export function parseSellerSnapshot(raw: string | null): Partial<SellerSnapshot> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Partial<SellerSnapshot>;
  } catch {
    return {};
  }
}

export function parseCustomerSnapshot(raw: string | null): Partial<CustomerSnapshot> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Partial<CustomerSnapshot>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/**
 * Allocates the next invoice number inside the caller's transaction.
 *
 * The counter is bumped with an atomic `upsert ... increment`, so two
 * simultaneous requests can never read the same value - there is no
 * read-then-increment window. The number is also unique at the database level
 * (`Invoice.number @unique`), so even a fault here cannot persist a duplicate.
 *
 * Running inside the caller's transaction means a rolled-back generation does
 * not leave an issued number behind; the trade-off is that a number may be
 * skipped when a generation fails, which is acceptable for an invoice series and
 * far better than a duplicate.
 *
 * shortcut: the series resets each calendar year and may contain gaps; if a
 * jurisdiction requires an unbroken statutory series, replace this before go-live.
 */
export async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${INVOICE_NUMBER_PREFIX}-${year}`;

  const counter = await tx.counter.upsert({
    where: { key },
    update: { value: { increment: 1 } },
    create: { key, value: 1 },
  });

  return `${INVOICE_NUMBER_PREFIX}-${year}-${String(counter.value).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type GeneratedInvoice = {
  id: string;
  number: string;
  totalPaise: number;
  currency: string;
  bookingId: string;
  bookingReference: string;
};

/**
 * Issues an invoice for a booking.
 *
 * Everything is re-validated here against the database, never against anything
 * the caller passed: the booking's state, its price, whether an invoice already
 * exists. The write happens in one transaction that:
 *
 *   1. moves the booking COMPLETED -> INVOICE_GENERATED **conditionally**, so
 *      exactly one of two concurrent requests can win,
 *   2. appends that transition to the booking's append-only status log,
 *   3. reserves the next invoice number,
 *   4. writes the invoice, its line items and its financial snapshots.
 *
 * A failure at any step rolls the whole thing back, leaving no half-issued
 * invoice and no booking stranded in INVOICE_GENERATED.
 *
 * Returns null when the booking does not exist, so the route answers 404 without
 * the library deciding HTTP semantics for a missing record.
 */
export async function generateInvoiceForBooking(
  bookingId: string,
  actorId: string,
): Promise<GeneratedInvoice | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      status: true,
      charging: true,
      quotedPaise: true,
      addressLine1: true,
      addressLine2: true,
      area: true,
      city: true,
      state: true,
      pincode: true,
      contactName: true,
      contactPhone: true,
      customerId: true,
      service: { select: { name: true } },
      provider: {
        select: {
          id: true,
          displayName: true,
          legalName: true,
          registeredAddress: true,
          contactEmail: true,
          contactPhone: true,
          gstin: true,
        },
      },
      invoice: { select: { id: true } },
    },
  });

  if (!booking) return null;

  const eligibility = assessInvoiceEligibility({
    status: booking.status,
    charging: booking.charging,
    quotedPaise: booking.quotedPaise,
    hasInvoice: Boolean(booking.invoice),
    hasSeller: Boolean(booking.provider),
  });

  if (!eligibility.eligible) {
    throw new ApiError(eligibility.code, eligibility.reason, 409);
  }

  // Narrowed by the eligibility check above, restated so the types carry it.
  const provider = booking.provider;
  const quotedPaise = booking.quotedPaise;
  if (!provider || quotedPaise == null) {
    throw new ApiError('NOT_ELIGIBLE', 'This booking cannot be invoiced', 409);
  }

  const line = buildInvoiceLine({
    serviceName: booking.service.name,
    charging: booking.charging,
    quotedPaise,
  });
  const totals = calculateInvoiceTotals([line]);

  const seller = buildSellerSnapshot(provider);
  const customer = buildCustomerSnapshot(booking);

  let created: { id: string; number: string; totalPaise: number; currency: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      // Conditional claim of the booking. A concurrent generation that already
      // moved it updates zero rows here, so this request loses cleanly.
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: 'COMPLETED' },
        data: { status: 'INVOICE_GENERATED' },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          'CONFLICT',
          'This booking changed while the invoice was being issued. Reload and try again.',
          409,
        );
      }

      await tx.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          from: 'COMPLETED',
          to: 'INVOICE_GENERATED',
          actorId,
          actorRole: 'ADMIN',
          note: null,
        },
      });

      const number = await nextInvoiceNumber(tx);

      return tx.invoice.create({
        data: {
          number,
          bookingId: booking.id,
          customerId: booking.customerId,
          providerId: provider.id,
          status: 'ISSUED',
          subtotalPaise: totals.subtotalPaise,
          taxPaise: totals.taxPaise,
          totalPaise: totals.totalPaise,
          currency: 'INR',
          taxRateBps: INVOICE_TAX_RATE_BPS,
          sellerSnapshot: JSON.stringify(seller),
          customerSnapshot: JSON.stringify(customer),
          issuedAt: new Date(),
          lineItems: {
            create: [
              {
                description: line.description,
                charging: line.charging,
                quantity: line.quantity,
                unitPaise: line.unitPaise,
                amountPaise: line.amountPaise,
              },
            ],
          },
        },
        select: { id: true, number: true, totalPaise: true, currency: true },
      });
    });
  } catch (err) {
    // The database-level uniqueness constraints (number, bookingId) are the last
    // line of defence; map their violation to an honest conflict.
    if (isUniqueViolation(err)) {
      throw new ApiError(
        'ALREADY_INVOICED',
        'An invoice has already been issued for this booking.',
        409,
      );
    }
    throw err;
  }

  await audit({
    action: 'INVOICE_CREATED',
    entityType: 'Invoice',
    entityId: created.id,
    actorId,
    actorRole: 'ADMIN',
    metadata: {
      number: created.number,
      bookingId: booking.id,
      bookingReference: booking.reference,
      totalPaise: created.totalPaise,
      taxPaise: totals.taxPaise,
    },
  });

  return { ...created, bookingId: booking.id, bookingReference: booking.reference };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}


// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Row shape for the admin invoice table. No contact data, no snapshots. */
export type InvoiceListRow = {
  id: string;
  number: string;
  status: string;
  statusLabel: string;
  totalPaise: number;
  currency: string;
  issuedAt: Date | null;
  createdAt: Date;
  booking: { id: string; reference: string };
  customer: { name: string };
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABEL[status as InvoiceStatus] ?? status;
}

/** True only for a canonical invoice status. Used to allowlist a filter value. */
export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return value in INVOICE_STATUS_LABEL;
}

export async function listInvoices(opts: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: InvoiceListRow[]; total: number; issuedTotal: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const where: Prisma.InvoiceWhereInput = {};
  // Only an exact, recognised status becomes a constraint.
  if (opts.status && isInvoiceStatus(opts.status)) where.status = opts.status;
  // Prisma parameterises these values, so a search term cannot become SQL.
  if (opts.q) {
    where.OR = [
      { number: { contains: opts.q } },
      { booking: { reference: { contains: opts.q } } },
      { customer: { name: { contains: opts.q } } },
    ];
  }

  const [rows, total, issuedTotal] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        status: true,
        totalPaise: true,
        currency: true,
        issuedAt: true,
        createdAt: true,
        booking: { select: { id: true, reference: true } },
        customer: { select: { name: true } },
      },
    }),
    prisma.invoice.count({ where }),
    // Whole-ledger figure, independent of the current filter and page.
    prisma.invoice.count({ where: { status: 'ISSUED' } }),
  ]);

  return {
    items: rows.map((r) => ({ ...r, statusLabel: invoiceStatusLabel(r.status) })),
    total,
    issuedTotal,
  };
}

/**
 * One invoice with its line items and both snapshots, for the admin detail view
 * and the PDF.
 *
 * `notes` is deliberately NOT selected: it is an internal, administrative field
 * with no customer-facing purpose. The seller and customer blocks come from the
 * snapshots, never from the live Provider or User rows, so a later profile edit
 * cannot alter a historical invoice.
 */
export async function getInvoiceById(invoiceId: string) {
  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      subtotalPaise: true,
      taxPaise: true,
      totalPaise: true,
      currency: true,
      taxRateBps: true,
      issuedAt: true,
      createdAt: true,
      sellerSnapshot: true,
      customerSnapshot: true,
      booking: { select: { id: true, reference: true, serviceType: true } },
      customer: { select: { name: true } },
      lineItems: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          description: true,
          charging: true,
          quantity: true,
          unitPaise: true,
          amountPaise: true,
        },
      },
    },
  });
}

export type AdminInvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>;

/**
 * The invoice for one booking, scoped to the CUSTOMER WHO OWNS IT.
 *
 * The customer id is part of the query, so a foreign invoice is never loaded and
 * is indistinguishable from one that does not exist - both yield null, and both
 * become a 404 at the route.
 */
export async function getInvoiceForCustomer(customerId: string, bookingId: string) {
  return prisma.invoice.findFirst({
    where: { bookingId, customerId },
    select: {
      id: true,
      number: true,
      status: true,
      subtotalPaise: true,
      taxPaise: true,
      totalPaise: true,
      currency: true,
      issuedAt: true,
      sellerSnapshot: true,
      customerSnapshot: true,
      booking: { select: { id: true, reference: true } },
      lineItems: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          description: true,
          charging: true,
          quantity: true,
          unitPaise: true,
          amountPaise: true,
        },
      },
    },
  });
}

/** Human label for a charging option, used on invoice line items. */
export function chargingLabel(charging: string | null): string {
  return charging ? CHARGING_LABEL[toChargingOption(charging)] : '';
}


/**
 * Maps a persisted invoice to the PDF view model.
 *
 * The seller and customer blocks are read from the stored SNAPSHOTS, never from
 * the live Provider or User rows. That is the whole point of the snapshot: a
 * later price, contact-detail or address change cannot rewrite a document that
 * has already been issued.
 */
export function toInvoicePdfDocument(invoice: {
  number: string;
  status: string;
  issuedAt: Date | null;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  sellerSnapshot: string | null;
  customerSnapshot: string | null;
  booking: { reference: string };
  lineItems: Array<{
    description: string;
    charging: string | null;
    quantity: number;
    unitPaise: number;
    amountPaise: number;
  }>;
}): InvoicePdfDocument {
  const seller = parseSellerSnapshot(invoice.sellerSnapshot);
  const customer = parseCustomerSnapshot(invoice.customerSnapshot);

  return {
    number: invoice.number,
    statusLabel: invoiceStatusLabel(invoice.status),
    issuedAt: invoice.issuedAt,
    bookingReference: invoice.booking.reference,
    seller: {
      // Missing snapshot fields render as empty, never as a fabricated default.
      name: seller.name ?? '',
      legalName: seller.legalName ?? null,
      address: seller.address ?? null,
      email: seller.email ?? null,
      phone: seller.phone ?? null,
      gstin: seller.gstin ?? null,
    },
    customer: {
      name: customer.name ?? '',
      contactName: customer.contactName ?? '',
      contactPhone: customer.contactPhone ?? '',
      address: customer.address ?? '',
    },
    lines: invoice.lineItems.map((line) => ({
      description: line.description,
      chargingLabel: chargingLabel(line.charging),
      quantity: line.quantity,
      unitPaise: line.unitPaise,
      amountPaise: line.amountPaise,
    })),
    subtotalPaise: invoice.subtotalPaise,
    taxPaise: invoice.taxPaise,
    totalPaise: invoice.totalPaise,
    currency: invoice.currency,
  };
}

