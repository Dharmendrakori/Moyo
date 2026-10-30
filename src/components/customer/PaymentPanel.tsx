'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/format';
import { readCsrfToken } from '@/components/admin/LogoutButton';
import { Icon } from '@/components/ui/Icon';

/**
 * CUSTOMER PAYMENT PANEL
 *
 * The browser side of paying an invoice. It is deliberately thin and is NOT
 * authoritative: it opens the gateway's own checkout, posts the gateway's
 * response to the server, and shows whatever the SERVER concluded.
 *
 * - No secret is present here. The publishable key id arrives from our own API
 *   for the checkout that is starting.
 * - The amount shown is the invoice total the server sent. Nothing here decides
 *   what is charged: the gateway order was created server-side from the
 *   persisted invoice.
 * - A success message only appears after `/payment/verify` returns 200. Closing
 *   the checkout early reports honestly that nothing was charged.
 * - Repeated clicks are blocked while a request is in flight, and the server's
 *   idempotent initiation makes a refresh safe.
 */

type PaymentPanelState = {
  state: string;
  label: string;
  canPay: boolean;
  note: string;
};

type Attempt = {
  id: string;
  statusLabel: string;
  amountLabel: string;
  createdLabel: string;
};

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = { open: () => void };
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

/** Loads the gateway's checkout script exactly once per page. */
function loadCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error('checkout unavailable'));
    });
    script.addEventListener('error', () => reject(new Error('checkout unavailable')));
    if (!existing) {
      script.src = CHECKOUT_SCRIPT;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

export function PaymentPanel({
  bookingId,
  invoiceNumber,
  amountLabel,
  payment,
  attempts,
}: {
  bookingId: string;
  invoiceNumber: string;
  amountLabel: string;
  payment: PaymentPanelState;
  attempts: Attempt[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(response: RazorpayResponse) {
    const res = await fetch(`/api/bookings/${bookingId}/payment/verify`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrfToken() },
      body: JSON.stringify(response),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(null);
      setError(
        payload?.error?.message ??
          'We could not confirm this payment yet. If money left your account it will be confirmed automatically - please refresh in a minute.',
      );
      return;
    }

    setMessage('Payment confirmed. This invoice is now paid.');
    // Re-render from the database: the client never invents the new state.
    router.refresh();
  }

  async function pay() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/bookings/${bookingId}/payment`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrfToken() },
        body: '{}',
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? 'The payment could not be started. Please try again.');
        return;
      }

      const started = (await res.json()) as {
        keyId: string;
        orderId: string;
        amountPaise: number;
        currency: string;
      };

      const Checkout = await loadCheckout();

      const checkout = new Checkout({
        key: started.keyId,
        order_id: started.orderId,
        amount: started.amountPaise,
        currency: started.currency,
        name: 'Seric Tech Solutions',
        description: `Invoice ${invoiceNumber}`,
        handler: (response: RazorpayResponse) => {
          setBusy(true);
          setMessage('Verifying your payment with the provider...');
          void verify(response).finally(() => setBusy(false));
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setMessage(
              'Checkout was closed before the payment completed. Nothing has been charged.',
            );
          },
        },
      });

      checkout.open();
    } catch {
      setError('The payment window could not be opened. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const settled = payment.state === 'PAID' || payment.state === 'REFUNDED';

  return (
    <section className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">Payment</h2>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
            payment.state === 'PAID'
              ? 'bg-success-bg text-success'
              : payment.state === 'FAILED'
                ? 'bg-danger-bg text-danger'
                : payment.state === 'PROCESSING' || payment.state === 'PENDING'
                  ? 'bg-warning-bg text-warning'
                  : 'bg-neutral-bg text-neutral',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {payment.label}
        </span>
      </div>

      <p className="mt-2 text-sm font-bold tabular-nums text-ink-900">{amountLabel}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">{payment.note}</p>

      {payment.canPay && (
        <button
          type="button"
          onClick={pay}
          disabled={busy}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="wallet" size={15} />
          {busy ? 'Starting secure checkout...' : `Pay ${amountLabel}`}
        </button>
      )}

      {message && (
        <p role="status" className="mt-3 rounded-lg bg-success-bg px-3 py-2 text-xs text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {attempts.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Payment attempts
          </h3>
          <ul className="mt-2 space-y-1.5">
            {attempts.map((attempt) => (
              <li key={attempt.id} className="flex justify-between gap-3 text-xs text-ink-600">
                <span>{attempt.createdLabel}</span>
                <span className="tabular-nums">{attempt.amountLabel}</span>
                <span className="font-medium text-ink-800">{attempt.statusLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!payment.canPay && !settled && payment.state !== 'PROCESSING' && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
          Online payment is unavailable for this invoice. Contact Seric Tech Solutions if you believe
          this is wrong.
        </p>
      )}
    </section>
  );
}
