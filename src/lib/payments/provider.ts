import 'server-only';
import { RazorpayProvider } from './razorpay';

/**
 * PAYMENT PROVIDER ABSTRACTION
 *
 * The invoice domain, the booking state machine and the admin console know
 * nothing about Razorpay. They talk to this interface, so adding a second
 * gateway later is a new implementation of `PaymentProvider` rather than an
 * edit to every caller - and, more importantly today, the gateway's quirks stay
 * behind one boundary.
 *
 * DELIBERATELY ABSENT: `createRefund`. No refund policy has been approved for
 * this business yet (see README "Payments - refunds"), so the application does
 * not initiate money movement it cannot justify. Refund STATE is read back from
 * the gateway and displayed; that is `fetchPayment(...).amountRefundedPaise` and
 * the signed `refund.*` webhook events.
 */

/** The provider name persisted on every Payment row. */
export const PAYMENT_PROVIDER = 'RAZORPAY' as const;
export type GatewayName = typeof PAYMENT_PROVIDER;

/** What we need back after creating an order. No secret, ever. */
export type GatewayOrder = {
  orderId: string;
  amountPaise: number;
  currency: string;
};

/**
 * The authoritative view of one gateway payment.
 *
 * Only the fields this application needs are projected: identifiers, money,
 * status and a safe failure description. No card data is requested, so none can
 * be stored or logged.
 */
export type GatewayPayment = {
  paymentId: string;
  orderId: string | null;
  /** created | authorized | captured | refunded | failed */
  status: string;
  captured: boolean;
  amountPaise: number;
  currency: string;
  amountRefundedPaise: number;
  refundStatus: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};

export interface PaymentProvider {
  readonly name: GatewayName;

  /** Creates a gateway order for an exact, server-calculated amount. */
  createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder>;

  /** Fetches the authoritative payment record. Used to verify a checkout. */
  fetchPayment(paymentId: string): Promise<GatewayPayment>;

  /** Verifies the signature the checkout returns to the browser. */
  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;

  /** Verifies the signature on a webhook delivery over the raw body. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
}

/**
 * The configured provider.
 *
 * A fresh, stateless instance per call - deliberately NOT cached on
 * `globalThis`. It holds no state worth sharing, and a module-scoped cache makes
 * the class identity depend on when the module graph was last evaluated (which
 * silently defeats `instanceof` checks across a reload).
 *
 * The caller is responsible for checking `isPaymentConfigured()` first; this
 * throws a typed `NOT_CONFIGURED` error rather than returning a stub that
 * reports fake success.
 */
export function getPaymentProvider(): PaymentProvider {
  return new RazorpayProvider();
}
