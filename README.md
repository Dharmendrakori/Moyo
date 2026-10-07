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
| **Admin authorization (server-enforced RBAC)** | **Implemented** |
| **Admin dashboard (live database metrics)** | **Implemented** |
| **Admin category management** | **Implemented** - read-only catalogue identity + activation |
| **Admin service management** | **Implemented** - search, filter, paging, detail, activation |
| **Admin charging-option management** | **Implemented** |
| **Admin published-pricing management** | **Implemented** |
| Admin bookings / dispatch / technicians / customers | **Not yet implemented** - shown as disabled "Soon" |
| Admin invoices / payments / reviews / audit log / settings | **Not yet implemented** - shown as disabled "Soon" |
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

## The admin console

`/admin` is a real operations console backed by the same server-side domain model
as the customer site. It is not a visual mockup and it runs on no mock data.

### Admin routes

| Route | What it does |
| --- | --- |
| `/admin` | Dashboard - live aggregates from the database |
| `/admin/categories` | The 20 official categories, read from the database |
| `/admin/services` | Service table: search, filters, pagination |
| `/admin/services/[id]` | Service detail, charging configuration, published pricing |
| `/admin/charging-options` | Which options MOYO offers, and Customer Budget ranges |
| `/admin/pricing` | Publish / withdraw published prices |

Modules that are **not yet built** (Bookings, Dispatch, Technicians, Customers,
Materials, Invoices, Payments, Reviews, Audit log, Settings) appear in the
sidebar as **disabled entries marked "Soon"**. They are deliberately not links:
a navigation item that leads to a 404 advertises a capability the console does
not have. No planned module is dressed up with fake functionality, sample rows or
placeholder metrics.

### Admin API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/categories` | Category list with live service counts |
| `PATCH /api/admin/categories/[id]` | Activate / deactivate a category |
| `GET /api/admin/services` | Service table (search, filter, page) |
| `GET /api/admin/services/[id]` | Service detail + count of existing quoted bookings |
| `PATCH /api/admin/services/[id]` | Activate / deactivate a service |
| `GET /api/admin/charging-options` | Every `ServiceOption` with its service context |
| `PATCH /api/admin/charging-options/[id]` | Availability, budget bounds, duration |
| `GET /api/admin/pricing` | Pricing table (filter by state, category, option) |
| `PATCH /api/admin/pricing/[id]` | Publish or withdraw a published price |

### Admin authorization

Authorization is enforced **on the server at every boundary**. Hiding a link in
React is never the control, and there is no client-side role check anywhere.

| Situation | Result |
| --- | --- |
| No session, admin page | `redirect` to `/login?next=/admin` (validated relative path, never an absolute URL) |
| No session, admin API | `401 UNAUTHENTICATED` |
| CUSTOMER / PROVIDER / TECHNICIAN, admin page | Explicit access-denied screen with no admin chrome and no database content |
| CUSTOMER / PROVIDER / TECHNICIAN, admin API | `403 FORBIDDEN` - no data, no write, no audit event |
| ADMIN | Allowed |

There are three independent layers, and removing any one does not remove the
protection:

1. **`src/proxy.ts`** - redirects a request that has no session cookie. It runs
   in the Edge runtime with **no database access**; it only checks that a cookie
   is *present*, so it is a UX optimisation, not a security control.
2. **`src/app/admin/layout.tsx`** - resolves the session and refuses non-admins
   before any page content or query runs.
3. **Per page and per route** - every admin page calls `requireAdminPage()`, and
   every admin API calls `adminReadGuard()` / `adminWriteGuard()`. This is the
   layer the automated tests exercise.

The role is read from the **database on every request** via `getCurrentUser`,
which re-validates the stored role with `isRole()` before it is used for any
decision. Sessions are opaque and database-backed, so a logout or a role change
takes effect on the very next request - there is no token that could carry a
stale claim.

### Roles

`CUSTOMER`, `PROVIDER`, `TECHNICIAN`, `ADMIN`. Only `ADMIN` may reach `/admin`
or `/api/admin/**`. `PROVIDER` and `TECHNICIAN` are scoped owners elsewhere in
the booking model, but are **not** administrators.

### Mutations

Every admin mutation runs this chain, in this order, **before the request body
is parsed**:

```
assertSameOrigin -> requireAdmin -> assertCsrf -> rate limit
                  -> Zod .strict() parse -> catalog write model
```

Authorization is therefore checked before application logic runs, let alone
before any write. A non-admin request is rejected as `UNAUTHENTICATED` /
`FORBIDDEN` without leaking whether its CSRF token was also wrong.

Each mutation has a confirmation dialog, disables its button while in flight,
reports the server's message verbatim as text on failure, and never updates
optimistically - the table re-renders from the database.

### What is editable, and what is not

Only two things are commercially editable, and each is the server's decision:

| Field | Editable | Notes |
| --- | --- | --- |
| `Category.name`, `.code`, `.position` | **No** | Authoritative official catalogue identity. Absent from the mutation schema, so they cannot be mass-assigned. |
| `Service.name`, `.slug`, `.serviceType`, placement | **No** | Same: absent from every mutation schema. |
| `Category.isActive`, `Service.isActive` | Yes | Deactivation hides a record from customers; nothing is deleted and all booking history is kept. |
| `ServiceOption.isActive` | Yes | Availability of a charging option. |
| `ServiceOption.budgetMin/MaxPaise` | Yes | **Customer Budget only.** Rejected server-side on the other two options. |
| `ServiceOption.pricePaise` | Yes, **only** via `PATCH /api/admin/pricing/[id]` | Deliberately absent from the charging-options schema, so enabling an option can never expose a price. |

Because every schema is `.strict()`, an unexpected key **rejects the whole
request** rather than being ignored. Ignoring it would leave a caller believing a
change had been made when it had not.

### Pricing rules

- **Server-authoritative.** The browser never supplies an amount.
  `resolveBookingPricing()` (`src/lib/pricing.ts`) is the single source of truth
  and takes **no price parameter at all**. `quoteSchema` and `createBookingSchema`
  are `.strict()` and have no price field, so posting one is rejected outright.
- **Unpublished is the default.** The seed creates every `ServiceOption` as
  inactive with `pricePaise = null`. No sample price is seeded to make the
  console look populated. Until a price is published, the customer service page
  shows its neutral **"On request"** state and the wizard reports that no
  charging option is available.
- **Historical quotes are immutable.** A booking stores the price it was quoted
  at creation (`quotedPaise`, `budgetMinPaise`, `budgetMaxPaise`). A price
  mutation writes **only** to `ServiceOption`; the pricing code path never reads
  or writes a `Booking` row. Re-pricing the catalogue cannot retroactively change
  an agreed quote. The service detail screen shows how many existing bookings
  hold a quote, so the consequence is visible before the change is made.
- **Publish guards.** A price cannot be published for a disabled option or a
  deactivated service, so a customer is never shown a price for something the
  booking domain would reject as unavailable.
- **Customer Budget carries no fixed price.** In that mode the customer states a
  budget and the provider confirms scope, so `resolveBookingPricing` always
  returns `quotedPaise: null`. Publishing a figure there is rejected
  (`PRICE_NOT_APPLICABLE`), because it would advertise a number that can never be
  quoted.

### The three official charging concepts

Preserved exactly as the domain model defines them in `src/lib/domain.ts`:
**Visit Charge**, **Fixed Charge**, **Customer Budget**. They are read back from
the seeded `ServiceOption` rows rather than restated as a new set. Customer Budget
keeps its existing min/max/range semantics: both bounds are required, must sit
inside the published range, and the server clamps them to the platform floor and
ceiling.

### Audit logging

Commercial and catalogue mutations write to the existing `AuditLog` model through
`src/lib/audit.ts`. Five actions were added for this milestone:

| Action | Recorded when |
| --- | --- |
| `CATEGORY_STATUS_CHANGED` | A category is activated or deactivated |
| `SERVICE_STATUS_CHANGED` | A service is activated or deactivated |
| `CHARGING_OPTION_CHANGED` | Availability, budget bounds or duration change |
| `PRICE_PUBLISHED` | A price becomes visible to customers |
| `PRICE_UNPUBLISHED` | A price is withdrawn |

Publication and withdrawal are deliberately **distinct** actions rather than one
generic "price updated": they are different events with different risk, and
collapsing them would make the log useless for reconstructing who changed what.
Each row records the previous and the new value, plus
`historicalBookingsUnchanged` for price events, so a disputed quote can be
reconstructed. No secrets, passwords, session tokens or personal data are ever
written.

### Operator identity and the provider contact email

`dharmendra.kori@outlook.com` is **both** the provider's published contact
address and the login address of an existing **CUSTOMER** account. These are
different things, and the architecture keeps them separate:

- `Provider.contactEmail` is a **display field**, rendered into the customer
  site's contact details and never used to authenticate anyone.
- `User.email` is the **login** address, and it is `@unique`.
- `User.role = 'ADMIN'` is **orthogonal to both**. `requireAdmin()` resolves
  authorization from the session's role only; it never compares an email against
  the provider record.

The consequence: **an operator login does not need the provider contact email.**
An administrator is created with whatever free address is configured in
`SEED_ADMIN_EMAIL`, and nothing about the existing customer account has to
change. That account is therefore left exactly as it is - not deleted, not
converted to ADMIN, and its login is not broken. `prisma/seed.ts` also refuses to
take the contact address from it, and now reports the address the provider
account actually retained, so the operator can see which login to use.

**No admin account exists in the current development database** (`admins: 0`),
because `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are intentionally blank in
`.env`. Set them once, run `npm run db:seed`, then remove them. There is no
default password anywhere in this repository.

### The 20 categories

The category list is read from the database at request time via
`listAdminCategories()`. There is **no client-side copy** of the 20 categories
anywhere in the admin console: a duplicated constant would drift and could show
a category the catalogue does not contain. The seed in `prisma/catalog.ts`
remains the only place the official list is defined.

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

The suites run without a database. Several drive the **real route handlers**,
mocking only Prisma, `next/headers` and `server-only`, so the genuine guard chain
executes end to end.

| Suite | Tests | What it drives |
| --- | --- | --- |
| `booking-state.test.ts` | 15 | The booking state machine, including that no role may mark a booking paid |
| `security.test.ts` | 10 | Open-redirect prevention and role/status narrowing |
| `booking-tracking.test.ts` | 15 | Customer-facing status rendering |
| `provider-identity.test.ts` | 14 | MOYO identity and contact values, and that retired values are absent from source |
| `validation.test.ts` | 21 | Request schemas |
| `booking-api.test.ts` | 23 | Real `/api/bookings*` routes: `requireUser → assertCsrf → rate limit → Zod → domain` |
| **`admin-auth.test.ts`** | **16** | **Real `/api/admin/*` routes: 401, 403 for CUSTOMER, ADMIN access, CSRF, Origin, malformed ids** |
| **`admin-pricing.test.ts`** | **16** | **Price publish/withdraw, strict validation, mass-assignment refusal, budget rules, audit actions, historical-quote immutability** |
| **`pricing-visibility.test.ts`** | **10** | **Published vs unpublished prices, and that the customer cannot influence the quote** |
| **Total** | **140** | |

The admin suites assert the properties that must not regress: a CUSTOMER gets
`403` on every admin endpoint and writes nothing, an unauthenticated caller gets
`401`, an ADMIN succeeds, a missing or guessed CSRF token fails even for an
ADMIN, a cross-origin mutation is refused, an unexpected key rejects the whole
request rather than being ignored, each mutation records the correct audit action,
and a price change leaves existing booking quotes untouched.

Two test-harness details are deliberate: the mock's `serviceOption.findUnique`
returns a **copy** so an update cannot retroactively mutate the "previous value"
snapshot the audit trail records, and the mock's `booking` model **throws on any
write**, so a future refactor that started rewriting bookings would fail loudly
rather than quietly change historical prices.

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
| `npm test` | PASS (140 tests, 9 suites) |
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
   administrator publishes prices. This is intentional, not a defect. Real prices
   are a commercial decision and have not been invented.
2. **Technician records are not seeded.** The platform does not know a technician's
   real availability, so none are invented. The tracking UI is built for them and
   shows the honest placeholder until one is assigned.
3. **Rate limiting is per-process.** See `SECURITY.md` §5.
4. **Most admin modules are not built.** The console covers the dashboard,
   catalogue, charging options and pricing. Bookings, dispatch, technicians,
   customers, materials, invoices, payments, reviews, the audit-log viewer and
   settings are shown as disabled "Soon" entries. They have no screens and no
   fake behaviour. The audit events *are* written to the database for every
   mutation this milestone introduces - only the screen to browse them is missing.
5. **Invoice, payment and feedback have no customer UI.** The schema, state
   machine and webhook exist; the screens do not.
6. **`/privacy` and `/terms` are linked in the footer but not implemented.**
7. **No admin account exists in the development database** (`admins: 0`) because
   `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are blank in `.env`. Set them once,
   run `npm run db:seed`, then remove them. There is no default password in the
   repository.
8. **The provider operator account still holds a retired login address.** It is
   not used for authentication by the console (see
   *Operator identity and the provider contact email* above) and was deliberately
   not changed, because rewriting a live account's login address is an identity
   decision, not a cosmetic one. Rotate it deliberately before launch.
9. SQLite and string-backed "enums" are development-only - see `SECURITY.md` §6.3.

---

## Roadmap

**Next milestone (dispatch)**
- Technician dispatch console: confirm a booking, assign a technician, advance
  the on-site states
- Admin bookings list with status filters, and an audit-log viewer over the events
  this milestone now writes
- Customer invoice view and payment initiation
- Customer cancellation flow

**Later**
- Technician roster and customer management screens
- Review moderation (schema and `FEEDBACK_PENDING` state already exist)
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

---

## Changelog - Admin shell sidebar layout fix

**Scope:** layout/CSS only in `src/components/admin/Chrome.tsx`. No change to
business logic, Prisma schema, seed data, authentication, RBAC, APIs, pricing
logic, booking logic, or the customer UI.

- **Root cause:** the desktop sidebar was `position: fixed` (`fixed inset-y-0
  left-0`) while the header and `main` content relied on a compensating
  `lg:ml-64` offset instead of occupying structural layout space, so dashboard
  content rendered underneath the sidebar whenever the offset drifted.
- **Fix:** the admin shell is now a structural flex column - the header spans
  the full width on top, and below it a `flex flex-1` row holds the sidebar as
  a real `w-64 shrink-0` column next to a `min-w-0 flex-1` main column. The
  desktop sidebar is `position: sticky` (`lg:sticky lg:top-16
  lg:h-[calc(100vh-4rem)]`), so it stays visible while scrolling yet still
  occupies its own width. All `fixed` positioning and `lg:ml-64` offsets were
  removed from the desktop shell; `fixed` + `z-40` remain only for the mobile
  drawer (below `lg`), which is a legitimate overlay.
- **Responsive behavior:** on desktop (`lg` and up) the sidebar is always
  visible in its own column and the main content uses the remaining width; on
  mobile/tablet the sidebar is hidden and the main content takes the full
  width, with the existing hamburger button opening the drawer overlay. Tables
  keep their own `overflow-x-auto` inside `DataTable`, so wide tables scroll
  internally instead of pushing the page wider than the viewport.
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors (4 pre-existing warnings in untouched files); `npm test` gives
  149 passed / 2 failed where both failures are pre-existing
  `tests/auth-url-security.test.ts` percent-encoding expectations in an
  untouched auth-redirect helper; `npx next build` compiles successfully with
  all admin routes (`/admin`, `/admin/categories`, `/admin/services`,
  `/admin/charging-options`, `/admin/pricing`, `/admin/services/[id]`) built.
  `npm run build` itself was not green end-to-end because `prisma generate`
  hit a Windows `EPERM` file-lock rename on
  `node_modules/.prisma/client/query_engine-windows.dll.node` (environmental,
  unrelated to this change). Browser verification at 1366/1440/1920px and
  375/768px was not possible in this environment (no screenshot-capable
  browser; the admin guard also redirects unauthenticated fetches to `/login`),
  so layout was verified from compiled output and source inspection instead.
- **Remaining limitation:** visual pixel-level confirmation (sidebar/content
  alignment, viewport scrolling, drawer behavior at 375/768px) still needs a
  manual pass in a real browser with an admin session.

---

## Changelog - Admin sidebar collapse/expand interaction

**Scope:** UI/layout interaction only in `src/components/admin/Chrome.tsx`.
No change to Prisma schema, seed data, authentication, RBAC, admin API guards,
booking logic, pricing logic, provider/catalog data, or the customer UI.

- **Root cause:** the header hamburger only opened the mobile drawer
  (`lg:hidden` button wired to `drawerOpen`) and had no desktop effect, while
  the desktop sidebar was a permanently expanded `w-64` column with its own
  separate X/close affordance nearby - two disconnected navigation behaviors
  instead of one coherent collapse/expand system.
- **Desktop expanded:** full `w-64` sidebar column - MOYO/Admin-console
  branding, section headings, icon + label items, SOON badges and "View
  customer site" all visible; main uses the remaining width.
- **Desktop collapsed:** narrow `w-20` icon rail, still a structural sticky
  flex column (never `fixed`, never an overlay) - logo icon stays centered,
  all nav icons stay visible/clickable, every text label/heading/SOON badge is
  hidden, and main expands into the freed width via the natural flex layout
  with a subtle `transition-[width] duration-200`.
- **Mobile/tablet (below lg):** unchanged drawer behavior - sidebar hidden,
  the same header hamburger opens the `fixed` overlay drawer, X closes it.
  Desktop `sidebarCollapsed` and mobile `drawerOpen` are separate state and
  never drive each other; the responsive toggle branches on a
  `(min-width: 1024px)` media query.
- **Accessibility:** the toggle carries `aria-controls="admin-sidebar"`,
  `aria-expanded` reflecting the desktop state, and a dynamic
  Collapse/Expand `aria-label`; the sidebar has `id="admin-sidebar"`;
  collapsed icons get `title`/`aria-label` tooltips (no new dependency - the
  project has no tooltip component); active-item highlighting and keyboard
  navigation are unchanged.
- **Files changed:** `src/components/admin/Chrome.tsx` only (plus this
  README entry). No persistence was added - plain `useState`, no
  database/schema change, no sensitive data stored.
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors; `npm test` gives 149 passed / 2 failed where both failures are the
  same pre-existing `tests/auth-url-security.test.ts` percent-encoding
  expectations in the untouched auth-redirect helper; `npx next build`
  compiles with all admin routes built. Authenticated manual verification at
  375/768/1024/1366/1440/1920px (hamburger toggles rail on desktop, drawer on
  mobile, no overlap/scrollbar) still needs a real browser pass with an admin
  session.
- **Known limitation:** collapse state is per-mount UI state (resets on
  navigation reload); no cross-session persistence by design.

---

## Changelog - Admin header toggle wiring fix

**Scope:** interaction wiring only in `src/components/admin/Chrome.tsx`. No
new state, no layout/styling change, no business-logic change.

- **Root cause:** the header used one button whose click branched at runtime
  on `window.matchMedia('(min-width: 1024px)')`. Any drift between that JS
  breakpoint check and the Tailwind `lg` visibility classes meant a desktop
  click could open the (hidden) mobile drawer instead of toggling the
  existing `sidebarCollapsed` rail state, so the hamburger appeared dead when
  the sidebar was collapsed.
- **Fix:** replaced the runtime breakpoint branch with two breakpoint-explicit
  buttons sharing the one header slot - a `hidden lg:block` desktop hamburger
  wired directly to `onClick={() => setSidebarCollapsed((c) => !c)}` (the
  existing state/setter, reused, nothing new), and a `lg:hidden` mobile
  hamburger that only opens the drawer. Same `menu` icon, same
  `aria-expanded={!sidebarCollapsed}` / `aria-controls="admin-sidebar"` /
  Collapse-Expand `aria-label` on the desktop button.
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors; `npx next build` compiles with all admin routes built; `npm test`
  unchanged (149 passed / 2 pre-existing `auth-url-security` failures in the
  untouched auth helper). Manual toggle check still needs an admin browser
  session: collapse, expand, repeat, then mobile drawer open/close below lg.