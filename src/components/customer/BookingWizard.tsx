'use client';

import { useCallback, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SericInlineSpinner, SericOverlayLoader } from '@/components/ui/SericLoader';
import { useBrowserGeolocation } from '@/components/customer/useBrowserGeolocation';
import {
  CHARGING_HINT,
  CHARGING_LABEL,
  MODE_LABEL,
  BOOKING_MODES,
  SERVICE_TYPE_LABEL,
  SERVICE_TYPES,
} from '@/lib/domain';
import { formatINR } from '@/lib/format';

/**
 * BOOKING WIZARD - steps 3 to 6
 *
 * Step 3  Charging option
 * Step 4  Booking details form
 * Step 5  Confirmation summary
 * Step 6  Booking created
 *
 * CLIENT VALIDATION IS UX ONLY. Everything posted here is re-validated by Zod
 * and, critically, the PRICE is resolved server-side on every step:
 *   - the displayed figure comes from POST /api/bookings/quote,
 *   - the booking itself resolves its own price again in the create route.
 * This component never computes an authoritative amount and has no field that
 * could send one.
 *
 * CSRF: every mutation echoes the double-submit token from the readable cookie.
 */

export type WizardOption = {
  charging: string;
  pricePaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  durationMinMinutes: number | null;
};

export type WizardCatalog = {
  categoryName: string;
  categorySlug: string;
  service: {
    id: string;
    name: string;
    slug: string;
    serviceType: string;
    description: string | null;
    includedWork: string | null;
  } | null;
  options: WizardOption[];
  defaults: { contactName: string; contactPhone: string };
};

type Quote = {
  charging: string;
  quotedPaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
};

type Details = {
  mode: string;
  serviceType: string;
  date: string;
  time: string;
  addressLine1: string;
  addressLine2: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  landmark: string;
  contactName: string;
  contactPhone: string;
  description: string;
  budgetMin: string;
  budgetMax: string;
};

const inputClass =
  'w-full rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 transition-colors duration-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60 aria-[invalid=true]:border-danger';

type FieldErrors = Record<string, string>;

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-ink-700">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Reads the double-submit CSRF token from the non-HttpOnly cookie. */
function readCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)moyo_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function BookingWizard({
  catalog,
  initialCharging,
  signedIn,
}: {
  catalog: WizardCatalog;
  initialCharging: string | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const headingId = useId();

  const [stage, setStage] = useState<'charging' | 'details' | 'confirm' | 'created'>(
    initialCharging ? 'details' : 'charging',
  );
  const [charging, setCharging] = useState<string>(initialCharging ?? '');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { detect: detectLocation, loading: locating, error: locationHookError } = useBrowserGeolocation();
  const [confirmed, setConfirmed] = useState(false);
  const [created, setCreated] = useState<{ id: string; reference: string } | null>(null);

  const [details, setDetails] = useState<Details>({
    mode: 'INSTANT',
    serviceType: catalog.service?.serviceType ?? 'REPAIR',
    date: '',
    time: '',
    addressLine1: '',
    addressLine2: '',
    area: '',
    city: '',
    state: '',
    pincode: '',
    landmark: '',
    contactName: catalog.defaults.contactName,
    contactPhone: catalog.defaults.contactPhone,
    description: '',
    budgetMin: '',
    budgetMax: '',
  });

  const update = useCallback((key: keyof Details, value: string) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  async function onUseLocation(): Promise<void> {
    const result = await detectLocation();
    if (!result) {
      // The hook sets its own error; mirror it for display.
      return;
    }
    setDetails((prev) => ({
      ...prev,
      addressLine1: result.line1 || prev.addressLine1,
      area: result.area || prev.area,
      city: result.city || prev.city,
      state: result.state || prev.state,
      pincode: result.pincode || prev.pincode,
      landmark: result.landmark || prev.landmark,
    }));
  }

  const needsBudget = charging === 'CUSTOMER_BUDGET';
  const needsSchedule = details.mode === 'LATER' || details.mode === 'SCHEDULED';

  // Return-to path after sign-in. Same-origin and relative by construction, so
  // it cannot become an open redirect; the login page also validates it.
  const nextHref = `/book?category=${encodeURIComponent(catalog.categorySlug)}&service=${encodeURIComponent(catalog.service?.slug ?? '')}&charging=${encodeURIComponent(charging)}`;

  /**
   * Asks the server what this booking would cost. A failure is surfaced
   * honestly - the wizard never falls back to a locally computed figure.
   */
  const loadQuote = useCallback(async () => {
    if (!catalog.service || !charging) return;
    setLoadingQuote(true);
    setQuoteError(null);
    try {
      const response = await fetch('/api/bookings/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrfToken() },
        credentials: 'same-origin',
        body: JSON.stringify({
          serviceId: catalog.service.id,
          charging,
          ...(needsBudget && details.budgetMin && details.budgetMax
            ? {
                budgetMin: Math.round(Number(details.budgetMin) * 100),
                budgetMax: Math.round(Number(details.budgetMax) * 100),
              }
            : {}),
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const shape = data as { error?: { message?: string } } | null;
        setQuote(null);
        setQuoteError(shape?.error?.message ?? 'Could not load pricing for this option.');
        return;
      }
      setQuote((data as { quote: Quote }).quote);
    } catch {
      setQuote(null);
      setQuoteError('Could not reach the server to check pricing.');
    } finally {
      setLoadingQuote(false);
    }
  }, [catalog.service, charging, needsBudget, details.budgetMin, details.budgetMax]);

  /** Local UX gate only. The server re-validates every field regardless. */
  function validateDetails(): boolean {
    const errors: FieldErrors = {};
    if (!details.addressLine1.trim()) errors.addressLine1 = 'Enter the service address';
    if (!details.area.trim()) errors.area = 'Enter your area or locality';
    if (!details.city.trim()) errors.city = 'Enter the city';
    if (!details.state.trim()) errors.state = 'Enter the state';
    if (!/^[1-9]\d{5}$/.test(details.pincode.trim())) errors.pincode = 'Enter a valid 6-digit PIN code';
    if (!details.contactName.trim()) errors.contactName = 'Enter a contact name';
    if (details.contactPhone.replace(/\D/g, '').length !== 10)
      errors.contactPhone = 'Enter a valid 10-digit mobile number';
    if (needsSchedule && !details.date) errors.date = 'Choose a preferred date';
    if (needsBudget) {
      const min = Number(details.budgetMin);
      const max = Number(details.budgetMax);
      if (!details.budgetMin || Number.isNaN(min) || min <= 0)
        errors.budgetMin = 'Enter a minimum budget';
      else if (!details.budgetMax || Number.isNaN(max) || max <= 0)
        errors.budgetMax = 'Enter a maximum budget';
      else if (min > max) errors.budgetMax = 'Maximum must be greater than the minimum';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onConfirmSubmit(event: FormEvent) {
    event.preventDefault();
    if (!catalog.service || !confirmed) return;
    // Duplicate-submission guard: the disabled button covers re-render races,
    // this covers two clicks landing before React commits the disabled state.
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    // Rupees -> paise. The server independently bounds and re-validates these.
    const budgetMin = Math.round(Number(details.budgetMin) * 100);
    const budgetMax = Math.round(Number(details.budgetMax) * 100);
    const scheduledFor =
      needsSchedule && details.date && details.time
        ? new Date(`${details.date}T${details.time}`).toISOString()
        : undefined;

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrfToken() },
        credentials: 'same-origin',
        body: JSON.stringify({
          serviceId: catalog.service.id,
          charging,
          mode: details.mode,
          serviceType: details.serviceType,
          ...(scheduledFor ? { scheduledFor } : {}),
          ...(needsBudget ? { budgetMin, budgetMax } : {}),
          address: {
            line1: details.addressLine1,
            ...(details.addressLine2 ? { line2: details.addressLine2 } : {}),
            area: details.area,
            city: details.city,
            state: details.state,
            pincode: details.pincode,
            ...(details.landmark ? { landmark: details.landmark } : {}),
          },
          contactName: details.contactName,
          contactPhone: details.contactPhone,
          ...(details.description ? { description: details.description } : {}),
        }),
      });

      const data: unknown = await response.json().catch(() => null);

      if (response.status === 401) {
        setFormError('Please sign in to complete your booking.');
        return;
      }
      if (!response.ok) {
        const shape = data as { error?: { message?: string; fields?: FieldErrors } } | null;
        setFormError(shape?.error?.message ?? 'Something went wrong. Please try again.');
        if (shape?.error?.fields) setFieldErrors(shape.error.fields);
        return;
      }

      const booking = (data as { booking: { id: string; reference: string } }).booking;
      setCreated({ id: booking.id, reference: booking.reference });
      setStage('created');
      router.refresh();
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // --- Step 6: created -------------------------------------------------------
  if (stage === 'created' && created) {
    return (
      <div className="rounded-card border border-success/30 bg-success-bg p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success text-white">
          <Icon name="check" size={24} />
        </span>
        <h2 id={headingId} className="mt-4 text-lg font-bold tracking-tight text-ink-900">
          Booking received
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          Your reference is{' '}
          <span className="font-mono font-bold text-ink-900">{created.reference}</span>.
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink-600">
          The provider will confirm this request. Seric Tech Solutions is the service identity you are booking
          with; technician details appear here once a technician is assigned.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href={`/bookings/${created.id}`}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
          >
            Track this booking
          </Link>
          <Link
            href="/bookings"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            My bookings
          </Link>
        </div>
      </div>
    );
  }

  // --- Step 3: charging option ----------------------------------------------
  if (stage === 'charging') {
    return (
      <div>
        <div className="rounded-card border border-ink-200 bg-white p-5">
          <h2 id={headingId} className="text-base font-bold tracking-tight text-ink-900">
            {catalog.service?.name}
          </h2>
          <p className="mt-1 text-sm text-ink-500">{catalog.categoryName}</p>
          {catalog.service?.description && (
            <p className="mt-3 text-sm leading-relaxed text-ink-600">{catalog.service.description}</p>
          )}
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-bold tracking-tight text-ink-900">
            How would you like to be charged?
          </legend>
          <p className="mt-1 text-xs text-ink-500">
            The provider publishes prices per option. Any amount shown is confirmed by the server.
          </p>

          {catalog.options.length === 0 ? (
            <p className="mt-4 rounded-card border border-ink-200 bg-white p-5 text-sm text-ink-600">
              No charging options are currently published for this service. Please contact the
              provider directly.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {catalog.options.map((option) => {
                const key = option.charging as keyof typeof CHARGING_LABEL;
                const label = CHARGING_LABEL[key] ?? option.charging;
                const isBudget = option.charging === 'CUSTOMER_BUDGET';
                /*
                 * Mirrors `resolveBookingPricing`: a fixed quote NEVER applies to
                 * a customer-budget booking, so a stored price is deliberately not
                 * shown here either. Showing one would contradict the amount the
                 * server will actually record.
                 */
                const published = !isBudget && option.pricePaise != null && option.pricePaise > 0;
                const inputId = `charging-${option.charging}`;
                return (
                  <label
                    key={option.charging}
                    htmlFor={inputId}
                    className="flex cursor-pointer items-start gap-3 rounded-card border border-ink-200 bg-white p-4 transition hover:border-brand-300 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name="charging"
                      value={option.charging}
                      checked={charging === option.charging}
                      onChange={() => {
                        setCharging(option.charging);
                        setQuote(null);
                        setQuoteError(null);
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink-900">{label}</span>
                        {/* A number only when the provider has actually published one. */}
                        <span
                          className={
                            published ? 'text-sm font-bold text-ink-900' : 'text-xs text-ink-400'
                          }
                        >
                          {published
                            ? formatINR(option.pricePaise)
                            : isBudget
                              ? 'You set the budget'
                              : 'Shown after booking'}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-ink-500">
                        {CHARGING_HINT[key] ?? ''}
                      </span>
                      {option.charging === 'CUSTOMER_BUDGET' &&
                        option.budgetMinPaise != null &&
                        option.budgetMaxPaise != null && (
                          <span className="mt-1 block text-xs text-ink-400">
                            Budgets accepted between {formatINR(option.budgetMinPaise)} and{' '}
                            {formatINR(option.budgetMaxPaise)}.
                          </span>
                        )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={`/book?category=${encodeURIComponent(catalog.categorySlug)}`}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            Back
          </Link>
          <button
            type="button"
            disabled={!charging}
            onClick={() => {
              setFormError(null);
              setStage('details');
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated disabled:opacity-50"
          >
            Continue
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </div>
    );
  }

  // --- Step 4: booking details ----------------------------------------------
  if (stage === 'details') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!validateDetails()) return;
          setConfirmed(false);
          setStage('confirm');
          /*
           * Fetched here, on the user's action, rather than in an effect. The
           * confirmation step cannot render a stale price, and an effect that
           * called setState synchronously would cause a cascading render.
           */
          void loadQuote();
        }}
        noValidate
      >
        <h2 id={headingId} className="text-base font-bold tracking-tight text-ink-900">
          Booking details
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          {catalog.service?.name} &middot;{' '}
          {CHARGING_LABEL[charging as keyof typeof CHARGING_LABEL] ?? charging}
        </p>

        {formError && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger">
            {formError}
          </p>
        )}

        {!signedIn && (
          <div className="mt-4 rounded-lg bg-warning-bg p-4">
            <p className="text-sm font-semibold text-warning">Sign in to continue</p>
            <p className="mt-1 text-sm text-ink-600">
              You need an account to place and track a booking. Your entries stay on this page.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(nextHref)}`}
              className="mt-3 inline-block rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
            >
              Sign in
            </Link>
          </div>
        )}

        <fieldset className="mt-6 rounded-card border border-ink-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-ink-900">
            When do you need the service?
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BOOKING_MODES.map((mode) => {
              const id = `mode-${mode}`;
              return (
                <label
                  key={mode}
                  htmlFor={id}
                  className="cursor-pointer rounded-xl border border-ink-200 p-3 text-center text-xs font-semibold text-ink-700 transition-all duration-200 hover:border-brand-300 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 has-[:checked]:shadow-card"
                >
                  <input
                    id={id}
                    type="radio"
                    name="mode"
                    value={mode}
                    checked={details.mode === mode}
                    onChange={() => update('mode', mode)}
                    className="sr-only"
                  />
                  {MODE_LABEL[mode]}
                </label>
              );
            })}
          </div>

          {needsSchedule && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Preferred date" error={fieldErrors.date}>
                <input
                  id="date"
                  type="date"
                  value={details.date}
                  onChange={(e) => update('date', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.date)}
                  className={inputClass}
                />
              </Field>
              <Field label="Preferred time" hint="Optional. Leave blank for any time.">
                <input
                  id="time"
                  type="time"
                  value={details.time}
                  onChange={(e) => update('time', e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          )}

          <div className="mt-4">
            <Field label="Service purpose">
              <select
                id="serviceType"
                value={details.serviceType}
                onChange={(e) => update('serviceType', e.target.value)}
                className={inputClass}
              >
                {SERVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SERVICE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="mt-4 rounded-card border border-ink-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-ink-900">Service location</legend>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-500">Fill the address from your current location.</span>
              <button
                type="button"
                onClick={() => void onUseLocation()}
                disabled={locating}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-card transition-all duration-300 hover:bg-ink-50 disabled:opacity-60"
              >
                <Icon name="location" size={14} />
                {locating ? 'Detecting…' : 'Use My Current Location'}
              </button>
            </div>
            {locationHookError && (
              <p role="alert" className="text-xs font-medium text-danger">
                {locationHookError.message}
              </p>
            )}
            {locating && (
              <p className="text-xs text-ink-500" aria-live="polite">
                Requesting location permission…
              </p>
            )}
            <Field label="Address" error={fieldErrors.addressLine1}>
              <input
                id="addressLine1"
                value={details.addressLine1}
                onChange={(e) => update('addressLine1', e.target.value)}
                aria-invalid={Boolean(fieldErrors.addressLine1)}
                autoComplete="address-line1"
                className={inputClass}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Area / locality" error={fieldErrors.area}>
                <input
                  id="area"
                  value={details.area}
                  onChange={(e) => update('area', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.area)}
                  className={inputClass}
                />
              </Field>
              <Field label="Landmark" hint="Optional">
                <input
                  id="landmark"
                  value={details.landmark}
                  onChange={(e) => update('landmark', e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="City" error={fieldErrors.city}>
                <input
                  id="city"
                  value={details.city}
                  onChange={(e) => update('city', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.city)}
                  className={inputClass}
                />
              </Field>
              <Field label="State" error={fieldErrors.state}>
                <input
                  id="state"
                  value={details.state}
                  onChange={(e) => update('state', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.state)}
                  className={inputClass}
                />
              </Field>
              <Field label="PIN code" error={fieldErrors.pincode}>
                <input
                  id="pincode"
                  inputMode="numeric"
                  maxLength={6}
                  value={details.pincode}
                  onChange={(e) => update('pincode', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.pincode)}
                  className={inputClass}
                />
              </Field>
            </div>
          </div>
        </fieldset>

        <fieldset className="mt-4 rounded-card border border-ink-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-ink-900">Contact</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Contact name" error={fieldErrors.contactName}>
              <input
                id="contactName"
                value={details.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                aria-invalid={Boolean(fieldErrors.contactName)}
                autoComplete="name"
                className={inputClass}
              />
            </Field>
            <Field label="Contact phone" error={fieldErrors.contactPhone}>
              <input
                id="contactPhone"
                type="tel"
                inputMode="numeric"
                value={details.contactPhone}
                onChange={(e) => update('contactPhone', e.target.value)}
                aria-invalid={Boolean(fieldErrors.contactPhone)}
                autoComplete="tel"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field
              label="Describe the issue"
              error={fieldErrors.description}
              hint="Optional, but it helps the technician prepare."
            >
              <textarea
                id="description"
                rows={3}
                maxLength={1500}
                value={details.description}
                onChange={(e) => update('description', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </fieldset>

        {needsBudget && (
          <fieldset className="mt-4 rounded-card border border-ink-200 bg-white p-5">
            <legend className="px-1 text-sm font-semibold text-ink-900">Your budget</legend>
            <p className="mt-1 text-xs text-ink-500">{CHARGING_HINT.CUSTOMER_BUDGET}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Minimum budget (₹)" error={fieldErrors.budgetMin}>
                <input
                  id="budgetMin"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={details.budgetMin}
                  onChange={(e) => update('budgetMin', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.budgetMin)}
                  className={inputClass}
                />
              </Field>
              <Field label="Maximum budget (₹)" error={fieldErrors.budgetMax}>
                <input
                  id="budgetMax"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={details.budgetMax}
                  onChange={(e) => update('budgetMax', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.budgetMax)}
                  className={inputClass}
                />
              </Field>
            </div>
          </fieldset>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStage('charging')}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            Back
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
          >
            Review booking
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </form>
    );
  }

  // --- Step 5: confirmation --------------------------------------------------
  const scheduleLabel = needsSchedule
    ? details.date
      ? `${details.date}${details.time ? ` at ${details.time}` : ''}`
      : 'Not specified'
    : (MODE_LABEL[details.mode as keyof typeof MODE_LABEL] ?? details.mode);

  return (
    <form onSubmit={onConfirmSubmit} noValidate>
      {/* Blocking state: placing a booking owns the whole screen until the
          request settles (success or failure both clear `submitting`). */}
      {submitting && <SericOverlayLoader label="Placing your booking" />}
      <h2 id={headingId} className="text-base font-bold tracking-tight text-ink-900">
        Review your booking
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        Check the details below. Nothing is submitted until you confirm.
      </p>

      {formError && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-card border border-ink-200 bg-white">
        <dl className="divide-y divide-ink-100">
          <ConfirmRow label="Category" value={catalog.categoryName} />
          <ConfirmRow label="Service" value={catalog.service?.name ?? '—'} />
          <ConfirmRow
            label="Purpose"
            value={
              SERVICE_TYPE_LABEL[details.serviceType as keyof typeof SERVICE_TYPE_LABEL] ??
              details.serviceType
            }
          />
          <ConfirmRow
            label="Charging option"
            value={CHARGING_LABEL[charging as keyof typeof CHARGING_LABEL] ?? charging}
          />
          <ConfirmRow label="Schedule" value={scheduleLabel} />
          <ConfirmRow
            label="Location"
            value={[details.addressLine1, details.area, details.city, details.state, details.pincode]
              .filter(Boolean)
              .join(', ')}
          />
          <ConfirmRow label="Contact" value={`${details.contactName} · ${details.contactPhone}`} />
          {details.description && <ConfirmRow label="Description" value={details.description} />}
        </dl>

        {/* Price block: the estimate stays visibly distinct from the invoice. */}
        <div className="border-t-2 border-ink-200 bg-ink-50 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Estimated / published service price
            </p>
            <StatusBadge
              label={quote ? 'Server confirmed' : loadingQuote ? 'Checking…' : 'Not available'}
              tone={quote ? 'success' : 'neutral'}
            />
          </div>

          {loadingQuote && (
            <div className="mt-3 flex items-center gap-3 text-sm text-ink-500" aria-live="polite">
              <SericInlineSpinner />
              <span>Checking pricing with the server…</span>
            </div>
          )}

          {quoteError && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-bg p-3 text-sm text-danger">
              {quoteError}
            </p>
          )}

          {quote && !loadingQuote && (
            <>
              <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-ink-900">
                {quote.quotedPaise != null && quote.quotedPaise > 0
                  ? formatINR(quote.quotedPaise)
                  : quote.budgetMinPaise != null && quote.budgetMaxPaise != null
                    ? `${formatINR(quote.budgetMinPaise)} – ${formatINR(quote.budgetMaxPaise)}`
                    : 'Not published'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-600">
                {quote.quotedPaise != null && quote.quotedPaise > 0
                  ? 'This is a published service price, not the final invoice. The final invoice is generated after the work is completed.'
                  : quote.budgetMinPaise != null && quote.budgetMaxPaise != null
                    ? 'No fixed price applies. The provider confirms what can be delivered within your budget.'
                    : 'The provider has not published a price for this option. The amount will be confirmed after the visit.'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Explicit, deliberate confirmation - required before submission. */}
      <div className="mt-4 rounded-card border border-ink-200 bg-white p-5">
        <label htmlFor="confirm" className="flex items-start gap-3">
          <input
            id="confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span className="text-sm text-ink-700">
            I confirm these details are correct and I want to place this booking with Seric Tech Solutions.
          </span>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setStage('details');
            void loadQuote();
          }}
          disabled={submitting}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!confirmed || submitting}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated disabled:opacity-50"
        >
          {submitting ? (
            <>
              <SericInlineSpinner />
              <span>Submitting…</span>
            </>
          ) : (
            <>
              <Icon name="check" size={16} />
              <span>Confirm and place booking</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-ink-800">{value}</dd>
    </div>
  );
}
