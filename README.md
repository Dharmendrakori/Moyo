# MOYO

A service operations platform for booking, tracking and managing field services.

> ## MOYO = THE CUSTOMER-FACING SERVICE PROVIDER / SERVICE IDENTITY
>
> For the current deployment, **MOYO is the service identity customers interact
> with**. It is the name stored in `Provider.displayName` / `Provider.legalName`
> and the name rendered on every customer-facing provider surface: the provider
> card, the service pages, the booking wizard, the confirmation summary and the
> booking tracking screen.
>
> No other provider name is shown to customers. The `Provider` model still
> supports multiple providers - it is a general schema - but the current seeded
> deployment has exactly one, and it is MOYO.
>
> Contact details are the authoritative business contact for Moyo. They are
> stored on the `Provider` record and rendered into the Call and WhatsApp
> actions, both of which resolve to `+917047172454`.

---

## Current status

| Area | State |
| --- | --- |
| Customer booking wizard (steps 1-6) | **Implemented** |
| Booking tracking UI + reusable status component | **Implemented** |
| Customer booking list / current booking | **Implemented** |
| Customer booking history | **Partially implemented** - list with status filters and paging; no date-range or export view |
| Technician assignment UI (customer side) | **Implemented** - shows real details only once assigned |
| Technician dispatch UI (operator side) | **Not yet implemented** |
| Invoicing, payment capture, feedback capture | **Not yet implemented** (schema and state machine exist; no customer UI) |
| Material ordering / cart | **Not yet implemented** |
| Support messaging | **Not yet implemented** |
| Account profile, password reset, email verification | **Not yet implemented** |
| Provider pricing administration | **Requires production configuration** - the admin panel exists; real prices are a commercial decision and are deliberately left unpublished by the seed |
| Payment provider integration | **Requires production configuration** |
| Deployment hardening (Redis rate limiting, PostgreSQL, native enums) | **Requires production configuration** - see [SECURITY.md](./SECURITY.md) §6 |

---

## What was here before

The repository previously contained a single 2,948-line static HTML file using
the Tailwind CDN and Font Awesome CDN, with client-side-only "routing", no
backend, no database, no authentication and no input validation. It contained a
reflected DOM XSS (a search dropdown interpolating a raw query string into
`innerHTML`) and presented fabricated operational claims - a named "available"
technician, arrival ETAs, "60-Min Instant Dispatch", "100% Genuine OEM Warranty",
"Verified Technicians", 4.7-4.9 ratings and a hard-coded visit fee.

That file is preserved verbatim at `legacy/index.html` for reference and is
excluded from lint, typecheck and the build.

**None of those fabricated claims survive into the new application.** Where a
price, rating, availability or ETA is not present in the database, the interface
says so plainly.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` |
| Database | Prisma ORM (SQLite for development, PostgreSQL for production) |
| Auth | Opaque database-backed sessions, bcrypt (cost 12), server-side RBAC |
| Validation | Zod, `.strict()` on request bodies |
| Styling | Tailwind CSS v4 (CSS-first `@theme`) |
| Tests | Vitest |
| Lint | ESLint 9 flat config |

**No third-party JavaScript or CSS runs on any page.** Icons are inline SVG and
fonts are self-hosted, which removes the CDN supply-chain risk and keeps the
Content-Security-Policy strict.

---

## Getting started

```bash
npm install

# Generates .env with a fresh random SESSION_SECRET (never overwrite an existing one)
node scripts/setup-env.mjs

# Create the database, generate the client, seed the catalog and the provider
npm run setup

npm run dev
```

The seed loads all **20 official categories** (98 services) exactly as specified
in `prisma/catalog.ts`, and registers MOYO as the service provider using only
the business details actually supplied.

### Creating an admin account

There is **no hard-coded admin password**. To bootstrap the first administrator,
set these in `.env`, run `npm run db:seed`, then remove them:

```bash
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_PASSWORD="a-strong-password-of-at-least-12-chars"
```

### Before the booking flow can be completed

The seed creates all three charging options per service as **inactive and
unpriced**. This is deliberate: a price is a commercial decision, and inventing
one would misrepresent the business. Until an administrator publishes pricing,
the wizard reaches step 3 and honestly reports that no charging option is
available, and the tracking screens say the price is not published.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite |
| `npm run setup` | Generate client, push schema, seed |
| `npm run db:reset` | Drop, recreate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run audit:prod` | Runtime dependency audit |

---

## The customer booking flow

```
Home → Category → Service → Charging option → Booking details
     → Confirmation → Booking created → [tracking] → Technician assignment
     → Technician visit → Job tracking → Job done → Invoice → Payment → Feedback
```

The first six stages are the customer booking wizard. The stages after
"Booking created" are the tracking lifecycle, which advances only when an
operator (or the payment webhook) moves the booking forward. **The UI never
advances a stage by itself.**

### Wizard steps

| Step | Screen | Rendered | Notes |
| --- | --- | --- | --- |
| 1 | Category | Server | The 20 official categories, via `listCategories()` |
| 2 | Service | Server | Services within the chosen category, via `getCategoryBySlug()` |
| 3 | Charging option | Server shell + client | The three official charging options, via `getServiceChargingOptions()` |
| 4 | Booking details | Client | Mode, purpose, address, contact, description, budget |
| 5 | Confirmation | Client | Full summary + **server-resolved** price + explicit confirmation checkbox |
| 6 | Booking created | Client | Booking reference, status, provider, next action |

Steps 1-3 are server-rendered so the catalog is never duplicated into a
client-side constant; the browser receives only the rows it needs. The URL
carries the selection (`/book?category=…&service=…&charging=…`), so every step
is linkable and back/forward work.

### Charging options

| Option | Label | Behaviour |
| --- | --- | --- |
| `VISIT_CHARGE` | Visit Charge | A visit/inspection charge applies; the final work cost is confirmed after inspection |
| `FIXED_CHARGE` | Fixed Charge | A published fixed price applies for the stated scope |
| `CUSTOMER_BUDGET` | Customer Budget | The customer supplies a minimum and maximum budget; the provider confirms what can be delivered within it |

### Pricing rules

1. **A client chooses WHICH option applies. It never chooses what it costs.**
   `resolveBookingPricing()` (`src/lib/pricing.ts`) is the only pricing authority.
2. `quotedPaise`, `customerId`, `providerId` and `status` are resolved or fixed on
   the server. The request schema is `.strict()`, so sending them is a **422**,
   not a silently ignored field.
3. The figure on the confirmation screen comes from `POST /api/bookings/quote`,
   which calls the same function the create route uses. The create route resolves
   the price **again**, so a tampered confirmation screen cannot change what is
   stored.
4. A published price is labelled **"Published service price (estimate)"** and is
   always accompanied by text distinguishing it from the final invoice. An
   unpublished price renders as **"Not published"** - never `₹0`, never a guess.
5. A budget booking never records a fixed quote (`quotedPaise` stays `NULL`),
   because the provider has not yet priced the work.

### Booking state model

```
REQUESTED → CONFIRMED → TECHNICIAN_ASSIGNED → TECHNICIAN_ON_THE_WAY
→ ARRIVED → SERVICE_IN_PROGRESS → COMPLETED → INVOICE_GENERATED
→ PAYMENT_PENDING → PAID → FEEDBACK_PENDING → CLOSED
                                                          ↘ CANCELLED
```

Transitions are validated server-side against `src/lib/booking-state.ts`. Roles
are keyed **per transition edge**, so a technician may mark work complete but may
not issue an invoice, and **no role at all** may set `PAID` - that edge is
reachable only through the signature-verified payment webhook.

The tracking UI derives its stages from this same list. Stages before the current
status are `complete`, the current one is `current`, and **every later stage stays
`pending`**. A cancelled booking shows a dedicated cancelled state rather than a
progress bar that would imply forward progress.

### Authentication and authorization

- Booking requires an authenticated session. The wizard is browsable signed-out,
  but the create route returns **401** without a session.
- `customerId` is taken from the session, never from the request.
- Ownership is enforced **inside the query**. `getCustomerBooking()` and
  `listCustomerBookings()` take the acting customer's id from the session and
  filter on it in SQL, so another customer's record is never loaded into memory.
- **Not-found and not-yours are indistinguishable** - both render the same 404
  page and return the same body, so the endpoints cannot be used to discover which
  booking ids exist.
- CSRF (double-submit token + origin check) is required on every mutation,
  including the quote preview.

---

---

## Routes and pages

| Route | Auth | Purpose |
| --- | --- | --- |
| `/` | Public | Homepage |
| `/categories` | Public | All 20 official categories |
| `/categories/[slug]` | Public | Services in a category |
| `/services/[slug]` | Public | Service detail, published pricing, provider |
| **`/book`** | Browse public, sign-in to submit | **Booking wizard, steps 1-6** |
| **`/bookings`** | Required | Customer's own bookings (current, filters, paging) |
| **`/bookings/[id]`** | Required + ownership | **Booking tracking for one booking** |
| `/login`, `/register` | Public | Authentication |
| `/admin` | `ADMIN` | Admin console |
| `/privacy`, `/terms` | Public | **Not yet implemented** (linked in the footer) |

Mobile navigation: `Home · Menu · Booking · Bookings · Account`.

---

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create a customer account |
| `POST` | `/api/auth/login` | Public | Start a session |
| `POST` | `/api/auth/logout` | Session | Revoke the session |
| `GET` | `/api/auth/csrf` | Public | Issue a CSRF token |
| `POST` | `/api/bookings` | Session | **Create a booking** (server-resolved pricing) |
| **`GET`** | **`/api/bookings`** | Session | **List the caller's own bookings** |
| **`GET`** | **`/api/bookings/[id]`** | Session + ownership | **Read one booking** |
| **`POST`** | **`/api/bookings/quote`** | Session + CSRF | **Server-side price preview (persists nothing)** |
| **`GET`** | **`/api/bookings/[id]/attachments`** | Session + ownership | List attachment metadata |
| **`POST`** | **`/api/bookings/[id]/attachments`** | Session + CSRF | Upload one validated image |
| `POST` | `/api/bookings/[id]/transition` | Session + role | Advance a booking's state |
| `POST` | `/api/webhooks/payment` | Signature | Mark a booking `PAID` |

Errors always return `{ error: { code, message, fields? } }`. Stack traces, SQL
errors and Prisma messages are never serialised to the client.

---

## Architecture

```
src/
├── app/
│   ├── (customer)/          Customer routes: /, /categories, /services, /book, /bookings
│   ├── admin/               Admin console: /admin
│   └── api/                 Route handlers (auth, bookings, webhooks)
├── components/
│   ├── customer/            Shell, Cards, BookingWizard, BookingStatus, AuthForms
│   ├── admin/               Admin shell and tables
│   └── ui/                  Design-system primitives
├── lib/
│   ├── auth.ts              Sessions, RBAC guards, CSRF
│   ├── access.ts            IDOR-safe ownership scoping
│   ├── booking-state.ts     State machine (single source of truth)
│   ├── booking-tracking.ts  Tracking view model (pure, unit tested)
│   ├── pricing.ts           Server-side price resolution
│   ├── customer-bookings.ts Ownership-scoped customer reads
│   ├── queries.ts           Catalog read models
│   ├── validation.ts        Zod schemas
│   ├── uploads.ts           Upload validation
│   ├── audit.ts             Audit logging
│   ├── rate-limit.ts        Rate limiting
│   ├── crypto.ts            bcrypt, tokens, hashing
│   ├── env.ts               Fail-fast environment validation
│   └── domain.ts            Canonical constants (see note below)
├── proxy.ts                 Edge security headers + auth redirects
prisma/
├── schema.prisma            Data model
├── catalog.ts               The 20 official categories
└── seed.ts                  Idempotent seeding
tests/
├── booking-state.test.ts    State machine invariants
├── booking-tracking.test.ts Tracking view model
├── booking-api.test.ts      Real route handlers (auth, CSRF, IDOR, pricing)
├── provider-identity.test.ts Provider identity, contacts and link targets
├── security.test.ts         Redirect and narrowing defences
├── validation.test.ts       Input validation and mass-assignment
└── stubs/                   Test-only shims for `server-only` and `next/headers`
```

### Testing approach

The suites run without a database. `booking-api.test.ts` drives the **real route
handlers**, mocking only Prisma, `next/headers` and `server-only`, so the genuine
guard chain (`requireUser → assertCsrf → rate limit → Zod → domain service`)
executes. Coverage includes unauthenticated access, missing/forged CSRF,
cross-origin rejection, invalid input, invalid charging options, budget validation
at both the schema and domain layers, server-side pricing (asserting the stored
price is the one the server resolved), mass-assignment defence, ownership
isolation, invalid booking ids, and rate limiting.

### Note on "enums"

The development datasource is SQLite, which Prisma cannot create native enums
for. Every enum-like column is therefore a `String` whose allowed values live in
`src/lib/domain.ts`, enforced by Zod at the API boundary and re-validated before
every write. **On PostgreSQL these should be promoted to native enums** for
database-level enforcement - see `SECURITY.md` §6.3.

---

## Security

Read **[SECURITY.md](./SECURITY.md)** before deploying.

It documents what is implemented, what was verified, and - importantly - **what
remains outstanding**. This project makes no claim of being vulnerability-free.
Security is a property of a deployed system, not of source code.

Current state (verified for the customer booking wizard + tracking milestone):

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 errors, 0 warnings) |
| `npm test` | PASS (98 tests, 6 suites) |
| `npm run build` | PASS (no warnings) |
| `npm run audit:prod` | 0 vulnerabilities |
| `npm run db:seed` | PASS (idempotent) |

### Security regression check for this milestone

This milestone was reviewed against the following. **No claim of being
vulnerability-free is made** - see `SECURITY.md` for what is still outstanding.

| Risk | How it is handled here |
| --- | --- |
| Client-trusted pricing | `quoteSchema` and `createBookingSchema` are `.strict()` with no price field; the price is re-resolved server-side on both the preview and the create |
| IDOR | Ownership is part of the SQL `where` clause; "not yours" and "not found" return identical 404s (asserted by test) |
| Privilege escalation | `customerId`, `providerId`, `role` and `status` are never accepted from the request |
| CSRF bypass | Double-submit token **and** origin check on every mutation, including the new quote and attachment routes |
| XSS | React escaping only; no `dangerouslySetInnerHTML`; ESLint `react/no-danger` is an error |
| Open redirect | The sign-in `next` value is built from known values and validated by `safeRedirectPath()` |
| Sensitive data exposure | Narrow projections; the booking list omits phone and full address; attachments return no filesystem path |
| Stack traces in responses | `apiHandler` returns a generic 500 and logs detail server-side only |
| Unsafe file handling | `uploads.ts` verifies MIME, extension, **magic bytes** and path containment; the filename is server-generated |
| ORM injection | All queries go through Prisma's parameterised API; the only dynamic value is an allowlisted status |
| CDN / external scripts | None. Inline SVG icons, self-hosted fonts, strict CSP |

### New in this milestone

| Control | Detail |
| --- | --- |
| `READ_POLICY`, `QUOTE_POLICY` | 120/min reads and 30/min quotes, per authenticated user |
| `ATTACHMENT_UPLOADED` audit action | Uploads are recorded without storing user-supplied paths |
| Attachment status gate | Uploads are refused once work has begun (`SERVICE_IN_PROGRESS` and later) |
| Tracking view model | `projectLifecycle()` cannot report a future stage as complete - asserted by test |
| Provider identity pinning | `provider-identity.test.ts` asserts the seeded identity and contacts, the generated Call and WhatsApp targets, and scans every active source file for retired values |

---

## Data honesty rules

These are enforced in code and partly by tests:

1. Prices come **only** from `ServiceOption` rows. The client selects which
   charging option applies; the server decides what it costs.
2. A published price is always labelled an **estimate**, never the final
   invoice, and an unpublished price renders as "Not published" - never `₹0`.
3. Ratings aggregate **approved** reviews only. With zero reviews the UI shows an
   explicit empty state, never `0 stars`.
4. Technician details appear **only after** a technician is assigned. Until then
   the UI says "Technician details will appear after assignment." No fabricated
   names, credentials, availability or arrival times.
5. Booking status hints and lifecycle stages never contain an ETA, a guarantee or
   a "100%" claim - asserted by a unit test that scans every string.
6. A future lifecycle stage is always rendered as **Pending**, never as reached.
7. A booking becomes `PAID` **only** via a signature-verified payment webhook. No
   user role can do it, including `ADMIN`.
8. Provider fields that would require verification (GSTIN, certifications) are
   `NULL` in the seed and render as neutral copy.

---

## Service catalog

The 20 official categories are defined in `prisma/catalog.ts` and seeded into the
database. They are **data, not markup** - there is no per-category HTML file, and
the wizard reads them from the database rather than from a client-side constant.
Renaming or reordering them is a data change.

---

## Known limitations

1. **No pricing is published by default.** The seed leaves every charging option
   inactive and unpriced, so a fresh install cannot complete a booking until an
   administrator publishes prices. This is intentional, not a defect.
2. **Technician records are not seeded.** The platform does not know a technician's
   real availability, so none are invented. The tracking UI is built for them and
   shows the honest placeholder until one is assigned.
3. **Rate limiting is per-process.** See `SECURITY.md` §5.
4. **No operator dispatch UI.** Bookings can be created and tracked, but
   confirming and assigning technicians requires direct API use today.
5. **Invoice, payment and feedback have no customer UI.** The schema, state
   machine and webhook exist; the screens do not.
6. `/privacy` and `/terms` are linked in the footer but not implemented.
7. SQLite and string-backed "enums" are development-only - see `SECURITY.md` §6.3.

---

## Roadmap

**Next milestone (operator side)**
- Technician dispatch console: confirm a booking, assign a technician, advance
  the on-site states
- Provider pricing administration, so the wizard can be completed end to end
- Customer invoice view and payment initiation
- Customer cancellation flow

**Later**
- Feedback capture once `FEEDBACK_PENDING` is reachable
- Material ordering / cart (schema already present)
- Support messaging (schema already present)
- Account profile, password reset, email verification
- Notifications over real channels (currently in-app only)

---

## Service provider identity and contact

MOYO is the customer-facing service identity for the current deployment. The
values below live on the `Provider` record and are rendered by
`getPrimaryProvider()` into every customer-facing provider surface.

| Field | Value |
| --- | --- |
| Display name (customer-facing) | **MOYO** |
| Legal name | **MOYO** |
| Slug | `moyo` |
| Registered address | Top Floor, Multicare Hospital, Royal Market, Bhopal, Madhya Pradesh 462030 |
| Email | `dharmendra.kori@outlook.com` |
| Phone / Call | `+917047172454` (`tel:+917047172454`) |
| WhatsApp | `+917047172454` (`https://wa.me/917047172454`) |

Call and WhatsApp deliberately use the **same number**. `Provider.contactPhone`
and `Provider.whatsappNumber` are both stored as `917047172454` - the digits
include the country code, because `telLink()` and `whatsappLink()` in
`src/lib/format.ts` normalise to digits and emit the international form.

### Renaming the provider without breaking relationships

`Provider.slug` is `@unique` and is not referenced anywhere else in the
application, so renaming it is safe - **but only if the existing row is migrated
in place**. Upserting on a new slug alone would create a *second* provider,
orphaning the original's `ProviderService` links and every `Booking.providerId`
foreign key that points at it.

`prisma/seed.ts` therefore keeps an explicit `LEGACY_PROVIDER_SLUGS` allowlist
and runs `migrateLegacyProviderSlug()` before the upsert, which moves the row and
preserves its id. Re-seeding is idempotent: a second run changes nothing.

### A note on the operator login account

The seed owns a `PROVIDER`-role `User` that owns the provider profile. Its
display name and phone are kept in step with the provider identity. Its **email
is only updated when the authoritative address is genuinely free** - `User.email`
is `@unique`, and taking the address from another account would break that
account's login. The customer-facing contact details live on the `Provider`
record and are always correct regardless.

---

## Rollback

The pre-refactor state is preserved on the `backup/pre-moyo-refactor` branch.

```bash
git checkout backup/pre-moyo-refactor
```

The refactor work is on `feature/moyo-platform`. `main` was never modified.