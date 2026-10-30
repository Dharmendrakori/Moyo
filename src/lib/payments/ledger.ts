import 'server-only';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { ApiError, notFound } from '@/lib/api';
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from '@/lib/domain';
import { isPaymentConfigured, razorpayPublicKey } from '@/lib/env';
import { PAYMENT_PROVIDER, getPaymentProvider, type GatewayPayment } from './provider';

/**
 * PAYMENT LEDGER
 *
 * SERVER-ONLY. Everything financial about a payment is decided here:
 *
 *  - the amount comes from the PERSISTED invoice, never from the browser;
 *  - an attempt is keyed by the invoice, so repeated initiation cannot create
 *    uncontrolled duplicates;
 *  - a payment becomes CAPTURED only from an authoritative gateway record - a
 *    fetched payment entity or a signature-verified webhook - and each write is
 *    a conditional update, so two concurrent settlements cannot both win;
 *  - the invoice keeps its issued snapshot untouched. Only `status`/`paidAt`
 *    move, and only once.
 *
 * NO REFUNDS ARE INITIATED. No refund policy has been approved for this
 * business, so the ledger only records refund state reported by the gateway.
 * Implementing a refund button without a policy would be inventing a financial
 * rule - see README "Payments - refunds".
 */

/** An invoice is payable only while it is an open, issued document. */
export const SETTLEABLE_INVOICE_STATUSES = ['ISSUED', 'OVERDUE'] as const;

/** Only INR is enabled on this deployment's gateway account. */
export const SUPPORTED_CURRENCY = 'INR';

export const isPaymentStatus = (value: string): value is PaymentStatus =>
  Object.prototype.hasOwnProperty.call(PAYMENT_STATUS_LABEL, value);

/** Statuses from which an attempt may still become the paid one. */
const OPEN_ATTEMPT_STATUSES: PaymentStatus[] = ['CREATED', 'PENDING', 'AUTHORIZED', 'FAILED'];

export type Payability =
  | { payable: true }
  | { payable: false; code: string; reason: string };

/**
 * Decides whether an invoice may be paid. Pure, so the page, the API and the
 * tests all reach the same verdict.
 */
export function assessInvoicePayability(invoice: {
  status: string;
  totalPaise: number;
  currency: string;
}): Payability {
  if (invoice.status === 'PAID') {
    return { payable: false, code: 'ALREADY_PAID', reason: 'This invoice has already been paid.' };
  }
  if (invoice.status === 'VOID') {
    return { payable: false, code: 'VOID', reason: 'This invoice was cancelled and cannot be paid.' };
  }
  if (!(SETTLEABLE_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) {
    return {
      payable: false,
      code: 'NOT_ISSUED',
      reason: 'This invoice has not been issued, so there is nothing to pay yet.',
    };
  }
  if (!Number.isSafeInteger(invoice.totalPaise) || invoice.totalPaise <= 0) {
    return { payable: false, code: 'INVALID_AMOUNT', reason: 'This invoice has no payable amount.' };
  }
  if (invoice.currency !== SUPPORTED_CURRENCY) {
    return {
      payable: false,
      code: 'UNSUPPORTED_CURRENCY',
      reason: `Only ${SUPPORTED_CURRENCY} payments are enabled. This invoice is in ${invoice.currency}.`,
    };
  }
  return { payable: true };
}

/** One attempt per invoice, enforced by the unique idempotency key. */
export function paymentIdempotencyKey(invoiceId: string): string {
  return `invoice:${invoiceId}`;
}

export const isUniqueViolation = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === 'P2002';

// ---------------------------------------------------------------------------
// Customer-facing state
// ---------------------------------------------------------------------------

export type PaymentState =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export type PaymentStateView = {
  state: PaymentState;
  label: string;
  /** True only when the invoice is payable AND no attempt has succeeded. */
  canPay: boolean;
  note: string;
};

/**
 * Maps "what the invoice says" plus "what the last attempt says" to one honest
 * sentence for the customer. Nothing here implies success that has not been
 * verified server-side.
 */
export function describePaymentState(input: {
  invoiceStatus: string;
  totalPaise: number;
  currency: string;
  attempt: { status: string; refundStatus: string | null; refundedPaise: number } | null;
}): PaymentStateView {
  const payable = assessInvoicePayability({
    status: input.invoiceStatus,
    totalPaise: input.totalPaise,
    currency: input.currency,
  });
  const blockedNote = payable.payable ? '' : payable.reason;
  const attempt = input.attempt;

  if (attempt?.refundStatus === 'PENDING' && attempt.refundedPaise > 0) {
    return {
      state: 'REFUND_PENDING',
      label: 'Refund pending',
      canPay: false,
      note: 'A refund has been requested with the payment provider and is still being processed.',
    };
  }
  if (attempt?.status === 'REFUNDED' || attempt?.status === 'PARTIALLY_REFUNDED') {
    return {
      state: 'REFUNDED',
      label: attempt.status === 'REFUNDED' ? 'Refunded' : 'Partly refunded',
      canPay: false,
      note: 'The payment provider reports this payment as refunded. Your bank may take a few days to credit it.',
    };
  }
  if (attempt?.status === 'CAPTURED' || input.invoiceStatus === 'PAID') {
    return {
      state: 'PAID',
      label: 'Payment received',
      canPay: false,
      note: 'This invoice is paid in full. No further payment is due.',
    };
  }
  if (attempt?.status === 'AUTHORIZED') {
    return {
      state: 'PROCESSING',
      label: 'Payment processing',
      canPay: false,
      note: 'Your bank approved the payment and it is being settled. This invoice updates once the provider confirms the capture.',
    };
  }
  if (attempt?.status === 'PENDING') {
    return {
      state: 'PENDING',
      label: 'Payment pending',
      canPay: payable.payable,
      note: payable.payable
        ? 'A payment was started but not completed. You can finish it now.'
        : blockedNote,
    };
  }
  if (attempt?.status === 'FAILED') {
    return {
      state: 'FAILED',
      label: 'Payment failed',
      canPay: payable.payable,
      note: payable.payable
        ? 'The last payment attempt did not complete. Nothing was charged - you can try again.'
        : blockedNote,
    };
  }
  return {
    state: 'NOT_STARTED',
    label: payable.payable ? 'Not paid yet' : 'Not payable',
    canPay: payable.payable,
    note: payable.payable
      ? 'This invoice is unpaid. Pay it securely through the payment gateway.'
      : blockedNote,
  };
}

/** Narrows an unknown stored status before it is used as a key or written. */
export function toPaymentStatus(value: string): PaymentStatus | null {
  return isPaymentStatus(value) ? value : null;
}

export function paymentStatusLabel(value: string): string {
  const status = toPaymentStatus(value);
  return status ? PAYMENT_STATUS_LABEL[status] : value;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const ATTEMPT_SELECT = {
  id: true,
  invoiceId: true,
  bookingId: true,
  provider: true,
  status: true,
  amountPaise: true,
  currency: true,
  gatewayOrderId: true,
  gatewayPaymentId: true,
  failureCode: true,
  failureReason: true,
  refundedPaise: true,
  refundStatus: true,
  signatureVerified: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type PaymentAttemptRow = {
  id: string;
  invoiceId: string;
  bookingId: string;
  provider: string;
  status: string;
  amountPaise: number;
  currency: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  refundedPaise: number;
  refundStatus: string | null;
  signatureVerified: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The attempt for an invoice, at most one by construction. */
export async function findAttemptByInvoice(invoiceId: string): Promise<PaymentAttemptRow | null> {
  return prisma.payment.findUnique({
    where: { idempotencyKey: paymentIdempotencyKey(invoiceId) },
    select: ATTEMPT_SELECT,
  });
}

export async function findAttemptByOrder(orderId: string): Promise<PaymentAttemptRow | null> {
  if (!orderId) return null;
  return prisma.payment.findUnique({ where: { gatewayOrderId: orderId }, select: ATTEMPT_SELECT });
}

export async function findAttemptByGatewayPayment(
  gatewayPaymentId: string,
): Promise<PaymentAttemptRow | null> {
  if (!gatewayPaymentId) return null;
  return prisma.payment.findUnique({
    where: { gatewayPaymentId },
    select: ATTEMPT_SELECT,
  });
}

export const paymentAttemptSelect = ATTEMPT_SELECT;

/** Gateway failure text, truncated and stripped of control characters. */
function safeFailure(text: string | null): string | null {
  if (!text) return null;
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 200) || null;
}

// ---------------------------------------------------------------------------
// Initiation
// ---------------------------------------------------------------------------

export type StartedPayment = {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  invoiceNumber: string;
  paymentId: string;
};

/**
 * Starts (or resumes) the payment for one invoice.
 *
 * The invoice is loaded BY OWNERSHIP - `customerId` is part of the query - so a
 * foreign invoice is never loaded and answers 404 indistinguishably from one
 * that does not exist.
 */
export async function startInvoicePayment(
  customerId: string,
  bookingId: string,
): Promise<StartedPayment> {
  if (!isPaymentConfigured()) {
    throw new ApiError('NOT_CONFIGURED', 'Online payment is not available right now.', 503);
  }

  const invoice = await prisma.invoice.findFirst({
    where: { bookingId, customerId },
    select: {
      id: true,
      number: true,
      status: true,
      totalPaise: true,
      currency: true,
      bookingId: true,
    },
  });
  if (!invoice) throw notFound('Invoice');

  const payable = assessInvoicePayability(invoice);
  if (!payable.payable) throw new ApiError(payable.code, payable.reason, 409);

  const attempt = await loadOrCreateAttempt(invoice);

  // A recorded capture is final: never hand out checkout for a paid invoice.
  if (attempt.status === 'CAPTURED' || attempt.status === 'REFUNDED' || attempt.status === 'PARTIALLY_REFUNDED') {
    throw new ApiError('ALREADY_PAID', 'This invoice has already been paid.', 409);
  }

  const result = (orderId: string): StartedPayment => ({
    keyId: razorpayPublicKey(),
    orderId,
    amountPaise: invoice.totalPaise,
    currency: invoice.currency,
    invoiceNumber: invoice.number,
    paymentId: attempt.id,
  });

  // Resuming: the order already exists for this invoice, so reuse it.
  if (attempt.gatewayOrderId) return result(attempt.gatewayOrderId);

  const order = await getPaymentProvider().createOrder({
    amountPaise: invoice.totalPaise,
    currency: invoice.currency,
    receipt: invoice.number,
    notes: { invoiceNumber: invoice.number, paymentRecord: attempt.id },
  });

  // The gateway must never define what the customer owes.
  if (order.amountPaise !== invoice.totalPaise || order.currency !== invoice.currency) {
    throw new ApiError('AMOUNT_MISMATCH', 'The payment order did not match the invoice amount.', 502);
  }

  const claimed = await prisma.payment.updateMany({
    where: { id: attempt.id, gatewayOrderId: null },
    data: { gatewayOrderId: order.orderId, status: 'PENDING' },
  });

  // shortcut: a lost initiation race leaves an unused, expiring order at the
  // gateway - no money moves. Upgrade to gateway-side idempotency if orphan
  // orders ever need to be reconciled.
  if (claimed.count !== 1) {
    const current = await prisma.payment.findUnique({
      where: { id: attempt.id },
      select: { gatewayOrderId: true },
    });
    if (!current?.gatewayOrderId) {
      throw new ApiError('CONFLICT', 'The payment could not be started. Please try again.', 409);
    }
    return result(current.gatewayOrderId);
  }

  await audit({
    action: 'PAYMENT_INITIATED',
    entityType: 'Payment',
    entityId: attempt.id,
    actorId: customerId,
    actorRole: 'CUSTOMER',
    metadata: { invoiceId: invoice.id, amountPaise: invoice.totalPaise, provider: PAYMENT_PROVIDER },
  });

  return result(order.orderId);
}

/**
 * Reads the invoice's attempt, creating it if absent.
 *
 * Two concurrent first clicks both try to insert; the unique idempotency key
 * lets exactly one win and the loser adopts the winner's row.
 */
async function loadOrCreateAttempt(invoice: {
  id: string;
  bookingId: string;
  totalPaise: number;
  currency: string;
}): Promise<PaymentAttemptRow> {
  const key = paymentIdempotencyKey(invoice.id);
  const existing = await findAttemptByInvoice(invoice.id);
  if (existing) return existing;

  try {
    return await prisma.payment.create({
      data: {
        idempotencyKey: key,
        invoiceId: invoice.id,
        bookingId: invoice.bookingId,
        provider: PAYMENT_PROVIDER,
        status: 'CREATED',
        amountPaise: invoice.totalPaise,
        currency: invoice.currency,
      },
      select: ATTEMPT_SELECT,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await findAttemptByInvoice(invoice.id);
    if (!raced) {
      throw new ApiError('PAYMENT_FAILED', 'The payment could not be started. Please try again.', 503);
    }
    return raced;
  }
}

// ---------------------------------------------------------------------------
// Settlement (the only path to PAID)
// ---------------------------------------------------------------------------

export type SettlementSource = 'CHECKOUT' | 'WEBHOOK';

export type SettlementOutcome = {
  status: PaymentStatus;
  invoiceStatus: string;
  /** True when this call actually moved the payment. */
  changed: boolean;
};

export type SettleableInvoice = {
  id: string;
  number: string;
  bookingId: string;
  totalPaise: number;
  currency: string;
  status: string;
};

/**
 * Applies an AUTHORITATIVE gateway payment record to an attempt.
 *
 * The caller has already established that the record is genuine - either by
 * verifying the checkout signature and fetching the payment, or by verifying
 * the webhook signature. This function still validates that the record belongs
 * to this order, invoice and amount before writing anything, because a genuine
 * record for a different payment must never settle this invoice.
 *
 * Every write is a conditional update. Two concurrent callers (a callback and a
 * webhook arriving together) therefore cannot both mark the invoice paid, and a
 * late failure event cannot rewind a capture.
 */
export async function settleFromGateway(input: {
  attempt: PaymentAttemptRow;
  invoice: SettleableInvoice;
  gatewayPayment: GatewayPayment;
  source: SettlementSource;
  actorId?: string | null;
}): Promise<SettlementOutcome> {
  const { attempt, invoice, source } = input;
  const p = input.gatewayPayment;
  const currentStatus: PaymentStatus = toPaymentStatus(attempt.status) ?? 'CREATED';

  const reject = async (code: string, message: string): Promise<never> => {
    await audit({
      action: 'PAYMENT_VERIFICATION_FAILED',
      entityType: 'Payment',
      entityId: attempt.id,
      actorId: input.actorId ?? null,
      metadata: { reason_code: code, source, invoiceId: invoice.id },
    });
    throw new ApiError(code, message, 409);
  };

  if (!attempt.gatewayOrderId || p.orderId !== attempt.gatewayOrderId) {
    return reject('ORDER_MISMATCH', 'This payment does not belong to the invoice order.');
  }
  if (
    !Number.isSafeInteger(p.amountPaise) ||
    p.amountPaise !== attempt.amountPaise ||
    p.amountPaise !== invoice.totalPaise
  ) {
    return reject('AMOUNT_MISMATCH', 'The payment amount does not match the invoice.');
  }
  if (p.currency !== attempt.currency || p.currency !== invoice.currency) {
    return reject('CURRENCY_MISMATCH', 'The payment currency does not match the invoice.');
  }

  const now = new Date();

  // --- Authorized: approved by the bank, not yet captured. No invoice change.
  if (p.status === 'authorized') {
    const res = await prisma.payment.updateMany({
      where: { id: attempt.id, status: { in: ['CREATED', 'PENDING'] } },
      data: {
        status: 'AUTHORIZED',
        gatewayPaymentId: p.paymentId,
        signatureVerified: true,
        verifiedAt: now,
      },
    });
    return { status: 'AUTHORIZED', invoiceStatus: invoice.status, changed: res.count === 1 };
  }

  // --- Failed: recorded, but never allowed to reverse a capture.
  if (p.status === 'failed') {
    const res = await prisma.payment.updateMany({
      where: { id: attempt.id, status: { in: ['CREATED', 'PENDING', 'AUTHORIZED'] } },
      data: {
        status: 'FAILED',
        gatewayPaymentId: p.paymentId,
        failureCode: safeFailure(p.errorCode),
        failureReason: safeFailure(p.errorDescription),
        signatureVerified: true,
        verifiedAt: now,
      },
    });
    if (res.count === 1) {
      await audit({
        action: 'PAYMENT_STATUS_CHANGED',
        entityType: 'Payment',
        entityId: attempt.id,
        actorId: input.actorId ?? null,
        metadata: { from: currentStatus, to: 'FAILED', source },
      });
    }
    return { status: 'FAILED', invoiceStatus: invoice.status, changed: res.count === 1 };
  }

  // --- Anything else (e.g. `created`) carries no settlement: leave it alone.
  if (!p.captured || p.status !== 'captured') {
    return { status: currentStatus, invoiceStatus: invoice.status, changed: false };
  }

  // --- Captured.
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: attempt.id, status: { in: OPEN_ATTEMPT_STATUSES } },
        data: {
          status: 'CAPTURED',
          gatewayPaymentId: p.paymentId,
          signatureVerified: true,
          verifiedAt: now,
          failureCode: null,
          failureReason: null,
          refundedPaise: p.amountRefundedPaise,
          refundStatus: safeFailure(p.refundStatus),
        },
      });

      // Conditional on the invoice as well: a second record for the same invoice
      // can never mark it paid twice.
      const invoiceClaim = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { in: [...SETTLEABLE_INVOICE_STATUSES] } },
        data: { status: 'PAID', paidAt: now },
      });

      if (invoiceClaim.count === 1) {
        const booking = await tx.booking.findUnique({
          where: { id: invoice.bookingId },
          select: { id: true, status: true, customerId: true },
        });

        if (booking?.status === 'PAYMENT_PENDING') {
          await tx.booking.update({ where: { id: booking.id }, data: { status: 'PAID' } });
          await tx.bookingStatusEvent.create({
            data: {
              bookingId: booking.id,
              from: 'PAYMENT_PENDING',
              to: 'PAID',
              // The payment provider settled this, not a user.
              actorId: null,
              actorRole: null,
              note: 'Settled by a verified payment',
            },
          });
        }

        if (booking) {
          await tx.notification.create({
            data: {
              userId: booking.customerId,
              channel: 'IN_APP',
              title: 'Payment received',
              body: `Payment for invoice ${invoice.number} is confirmed.`,
              link: `/bookings/${booking.id}`,
              status: 'SENT',
            },
          });
        }
      }

      return { changed: claimed.count === 1 };
    });

    if (outcome.changed) {
      await audit({
        action: 'PAYMENT_STATUS_CHANGED',
        entityType: 'Payment',
        entityId: attempt.id,
        actorId: input.actorId ?? null,
        metadata: {
          from: currentStatus,
          to: 'CAPTURED',
          source,
          invoiceId: invoice.id,
          amountPaise: p.amountPaise,
        },
      });
    }

    return { status: 'CAPTURED', invoiceStatus: 'PAID', changed: outcome.changed };
  } catch (err) {
    // The gateway payment id is unique: a second record claiming the same
    // gateway payment is a duplicate, not a settlement.
    if (isUniqueViolation(err)) {
      await audit({
        action: 'PAYMENT_VERIFICATION_FAILED',
        entityType: 'Payment',
        entityId: attempt.id,
        actorId: input.actorId ?? null,
        metadata: { reason_code: 'DUPLICATE_PAYMENT', source, invoiceId: invoice.id },
      });
      throw new ApiError('DUPLICATE_PAYMENT', 'This payment has already been recorded.', 409);
    }
    throw err;
  }
}

/**
 * Records refund state reported by the gateway.
 *
 * Read-only by design: this application does not initiate refunds, so all it can
 * do is mirror what the provider reports. The invoice itself stays PAID with its
 * original amount - a refund is a separate fact, not a rewrite of the document.
 */
export async function applyRefundStatus(
  attemptId: string,
  input: { refundedPaise: number; refundStatus: string },
): Promise<boolean> {
  const attempt = await prisma.payment.findUnique({
    where: { id: attemptId },
    select: { id: true, status: true, amountPaise: true },
  });
  if (!attempt) return false;

  // Only a captured payment can be refunded; anything else is ignored.
  if (!['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(attempt.status)) return false;

  const refunded = Math.min(Math.max(0, Math.trunc(input.refundedPaise)), attempt.amountPaise);
  const status: PaymentStatus =
    refunded > 0 && refunded >= attempt.amountPaise
      ? 'REFUNDED'
      : refunded > 0
        ? 'PARTIALLY_REFUNDED'
        : 'CAPTURED';

  await prisma.payment.update({
    where: { id: attempt.id },
    data: {
      refundedPaise: refunded,
      refundStatus: input.refundStatus.slice(0, 20).toUpperCase(),
      status,
    },
  });

  await audit({
    action: 'PAYMENT_STATUS_CHANGED',
    entityType: 'Payment',
    entityId: attempt.id,
    metadata: { to: status, refundedPaise: refunded, source: 'webhook' },
  });

  return true;
}

// ---------------------------------------------------------------------------
// Admin ledger (read-only)
// ---------------------------------------------------------------------------

export type PaymentListRow = {
  id: string;
  status: string;
  statusLabel: string;
  amountPaise: number;
  currency: string;
  provider: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  refundedPaise: number;
  refundStatus: string | null;
  createdAt: Date;
  verifiedAt: Date | null;
  invoice: { id: string; number: string };
  booking: { id: string; reference: string };
  customer: { name: string };
};

/**
 * The payment ledger for `/admin/payments`.
 *
 * Read-only on purpose: there is no administrative path that can mark a payment
 * successful, change an amount or edit a gateway reference. The search is a
 * parameterised Prisma `contains`, and a status is only applied when it is a
 * canonical value.
 */
export async function listPayments(opts: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: PaymentListRow[]; total: number; capturedTotal: number; capturedPaise: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const where: Record<string, unknown> = {};
  if (opts.status && isPaymentStatus(opts.status)) where.status = opts.status;
  if (opts.q) {
    where.OR = [
      { gatewayOrderId: { contains: opts.q } },
      { gatewayPaymentId: { contains: opts.q } },
      { invoice: { number: { contains: opts.q } } },
      { booking: { reference: { contains: opts.q } } },
      { invoice: { customer: { name: { contains: opts.q } } } },
    ];
  }

  const [rows, total, capturedTotal, capturedSum] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        amountPaise: true,
        currency: true,
        provider: true,
        gatewayOrderId: true,
        gatewayPaymentId: true,
        refundedPaise: true,
        refundStatus: true,
        createdAt: true,
        verifiedAt: true,
        invoice: { select: { id: true, number: true, customer: { select: { name: true } } } },
        booking: { select: { id: true, reference: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.count({ where: { status: 'CAPTURED' } }),
    prisma.payment.aggregate({ where: { status: 'CAPTURED' }, _sum: { amountPaise: true } }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      statusLabel: paymentStatusLabel(row.status),
      amountPaise: row.amountPaise,
      currency: row.currency,
      provider: row.provider,
      gatewayOrderId: row.gatewayOrderId,
      gatewayPaymentId: row.gatewayPaymentId,
      refundedPaise: row.refundedPaise,
      refundStatus: row.refundStatus,
      createdAt: row.createdAt,
      verifiedAt: row.verifiedAt,
      invoice: { id: row.invoice.id, number: row.invoice.number },
      booking: row.booking,
      customer: { name: row.invoice.customer.name },
    })),
    total,
    capturedTotal,
    capturedPaise: capturedSum._sum.amountPaise ?? 0,
  };
}

/** One payment with its invoice, booking and gateway references. */
export async function getPaymentById(paymentId: string) {
  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      ...ATTEMPT_SELECT,
      invoice: {
        select: { id: true, number: true, status: true, totalPaise: true, currency: true, issuedAt: true },
      },
      booking: { select: { id: true, reference: true } },
    },
  });
  if (!row) return null;

  const customer = await prisma.invoice.findUnique({
    where: { id: row.invoiceId },
    select: { customer: { select: { name: true } } },
  });

  return { ...row, customerName: customer?.customer.name ?? null };
}

export type AdminPaymentDetail = NonNullable<Awaited<ReturnType<typeof getPaymentById>>>;
