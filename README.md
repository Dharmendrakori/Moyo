# Seric Tech Solutions

A technology services platform for booking, tracking and managing field services.

> ## Seric Tech Solutions = THE CUSTOMER-FACING SERVICE IDENTITY
>
> For the current deployment, **Seric Tech Solutions is the service identity customers interact
> with**. It is the name stored in `Provider.displayName` / `Provider.legalName`
> and the name rendered on every customer-facing provider surface: the provider
> card, the service pages, the booking wizard, the confirmation summary and the
> booking tracking screen.
>
> No other provider name is shown to customers. The `Provider` model still
> supports multiple providers - it is a general schema - but the current seeded
> deployment has exactly one, and it is Seric Tech Solutions.
>
> Contact details are the authoritative business contact for Seric Tech Solutions. They are
> stored on the `Provider` record and rendered into the Call and WhatsApp
> actions, both of which resolve to `+917047172454`.

---

## Current status

| Area | State |
| --- | --- |
| Customer booking wizard (steps 1-6) | **Implemented** |
| Booking tracking UI + reusable status component | **Implemented** |
| Customer booking list / current booking | **Implemented** |
| Customer booking history | **Implemented** - list with status filters, paging, and technician assignment visibility |
| Technician assignment UI (customer side) | **Implemented** - shows real details only once assigned |
| Customer booking status tracking | **Implemented** - full lifecycle view with status progression, technician details, and ownership enforcement |
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
| **Admin bookings list** | **Implemented** - search by reference, status filter, server-side pagination; confirm and assign bookings; state transitions enforced server-side through the booking state machine |
| **Admin booking details** | **Implemented** - `/admin/bookings/[id]`: full persisted record, status history from the append-only log, confirm and assign-technician actions |
| **Admin console UI** | **Redesigned** - one shared design system across every admin route: responsive sidebar, breadcrumb header, KPI dashboard, premium tables and dialogs |
| Admin bookings / dispatch / technicians / customers | **Implemented** - bookings list is live; confirm, assign, and state transitions are functional via the admin console |
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
in `prisma/catalog.ts`, and registers Seric Tech Solutions as the service
provider using only the business details actually supplied.

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
| `/admin/charging-options` | Which options Seric Tech Solutions offers, and Customer Budget ranges |
| `/admin/pricing` | Publish / withdraw published prices |
| `/admin/bookings` | Every booking, newest first: reference search, status filter, pagination; rows open the booking detail |
| `/admin/bookings/[id]` | One booking in full: request details, location, customer, pricing vs invoice, technician, status history, and the confirm / assign actions |

Modules that are **not yet built** (Customers, Materials, Invoices, Payments, Reviews, Audit log, Settings) appear in the sidebar as **disabled entries marked "Soon"**. They are deliberately not links: a navigation item that leads to a 404 advertises a capability the console does not have. No planned module is dressed up with fake functionality, sample rows or placeholder metrics.

### Console design system

The console has one visual language, declared once and shared by every admin
route. There is no new UI framework and no new dependency: the design is built
from the existing Tailwind CSS v4 tokens in `src/app/globals.css` (brand blue,
the `ink` neutral ramp, the functional status colours, `--radius-card`, and the
layered `shadow-card` / `shadow-raised` / `shadow-overlay` scales). The
customer-facing site is untouched by this work.

| Piece | Where it lives | What it gives every screen |
| --- | --- | --- |
| Shell, sidebar, header | `src/components/admin/Chrome.tsx` | Brand block, grouped navigation (Overview / Catalog / Operations / Commerce / Platform), active-route marker, hover and focus states, collapsed icon rail at `lg`, overlay drawer below `lg`, breadcrumb + page title + role chip + identity + logout |
| Surfaces | `Panel`, `PageHeader`, `Notice` in `src/components/admin/DataTable.tsx` | Identical card border, radius, shadow and header rhythm on every page |
| Tables | `DataTable` | Shared header typography, row spacing, hover feedback, optional whole-row link, and `secondary` columns that drop below `lg` |
| Filters and paging | `Toolbar`, `SearchField`, `SelectField`, `Pager` | One field style, one focus ring, one pager |
| Metrics | `StatCard` | KPI tile with icon accent, value and honest hint |
| States | `EmptyState`, `LoadingState`, `ErrorState` in `src/components/ui/States.tsx` | No ambiguous blank areas |

Behavioural guarantees kept from before: search, filters, pagination and bulk
actions are still plain GET forms and real links, so every view is
URL-addressable; the sidebar keeps its separate desktop-collapse and mobile-drawer
states; animation is short and `prefers-reduced-motion` is honoured globally; and
the "Soon" items are still non-navigable `<span>`s, never links to a 404.

The dashboard was regrouped around real aggregates only: a dispatch KPI row, the
catalogue/commerce row, the 7-day booking chart, the status breakdown, a shortcut
panel that links only to routes that exist (and only to filters their schemas
accept), and an attention strip driven by counts that are actually non-zero.
Figures whose screens are still planned - invoices, reviews, support threads,
material orders - are shown as plain numbers with a note, never as links.


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
| `GET /api/admin/bookings` | Booking list: `q` (reference substring), `status` (allowlisted canonical status or `ALL`), bounded `page` / `pageSize` |
| `GET /api/admin/bookings/[id]` | Booking detail: full record for dispatch view |
| `POST /api/admin/bookings/[id]/confirm` | Confirm booking: REQUESTED → CONFIRMED (server-validated transition) |
| `POST /api/admin/bookings/[id]/assign-technician` | Assign technician: CONFIRMED → TECHNICIAN_ASSIGNED (server-validated, provider-bound) |

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

### Admin bookings: the dispatch queue

`/admin/bookings` is the dispatch queue: every booking in the database, newest
first, with a reference search box, a status filter and server-side pagination.
The page and `GET /api/admin/bookings` share one `.strict()` query schema
(`adminBookingQuerySchema` in `src/lib/validation.ts`): only `q`, `status`,
`page` and `pageSize` are accepted, an unknown parameter or a free-form status is
rejected (422 on the API, safe defaults on the page), and `status` reaches the
query only as an allowlisted canonical `BOOKING_STATUSES` value (`ALL` means no
constraint).

Authorization is the standard read chain (`adminReadGuard` on the API,
`requireAdminPage` on the page): 401 with no session, 403 for any non-ADMIN
role. The row projection (`listAllBookings` in `src/lib/customer-bookings.ts`)
is explicit - customer name and service location only, never phone, email or
street address. A table row is the worst place to expose contact data.

The header carries an awaiting-confirmation indicator. It is a real
`count({ status: 'REQUESTED' })` over the whole queue, not a count of the rows on
the current page, so it is never a page-local guess. Above the table, three
counts are shown: in the queue, matching the current view, and on this page.

Every row is a link to the booking detail. The stretched anchor in the first cell
means the whole row is clickable, hover-highlighted and reachable by keyboard
(`aria-label="Open booking SERIC-2026-000123"`); the reference cell stays a real
link, so the row works even if the overlay ever misbehaved.

### Admin booking detail

`/admin/bookings/[id]` is where a booking is actually handled. It renders one
booking from a single admin-only query (`getAdminBookingDetail`), with an
explicit projection:

| Section | What is shown |
| --- | --- |
| Booking information | Reference, status, created and updated timestamps, mode, requested service date, service, category, service type, provider, priority, charging option, and the customer's own description (or an honest "no description" line) |
| Service location and contact | Full address, landmark, area, contact name and a `tel:` link for the contact phone |
| Customer | Account name, email, phone, "customer since", and the account reference |
| Technician and dispatch | Assigned technician's name, headline, skills, phone, active/available state - or an explanation of why nobody is assigned yet |
| Pricing | The stored estimate or budget range with `summarisePrice()`, kept verbally and visually separate from the **final invoice** block (which says plainly when no invoice exists) |
| Lifecycle | Current stage, the next action, every recorded transition from the append-only `BookingStatusEvent` log (with the actor role and real timestamp), and the remaining stages explicitly labelled "not yet recorded" |

Nothing is invented. If a booking has no status event, the page says so instead
of rendering a synthetic timeline; a `null` quote renders "Not published", never
`₹0`; and a published price is always labelled an estimate with the note that the
invoice is produced after the work.

Two actions live on the page, and only when the current state allows them:

- **Confirm booking** - rendered for `REQUESTED` only. Opens a confirmation
  dialog, posts to `POST /api/admin/bookings/[id]/confirm`, disables while in
  flight, and shows the server's own message on failure.
- **Assign technician** - rendered for `CONFIRMED` with no technician. Loads real
  technician records from `GET /api/admin/technicians`, posts to
  `POST /api/admin/bookings/[id]/assign-technician`, and closes on Escape or
  backdrop click.

Both re-render from the database after success (`router.refresh()`), so the page
can never disagree with the server - the status badge, the timeline, the
technician panel and the action availability all update together. Neither
component sends a target status: they request an action and the server resolves
the transition through the booking state machine, so a hidden or hand-crafted
request cannot skip a step.


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
`src/lib/audit.ts`. Seven actions are now recorded:

| Action | Recorded when |
| --- | --- |
| `CATEGORY_STATUS_CHANGED` | A category is activated or deactivated |
| `SERVICE_STATUS_CHANGED` | A service is activated or deactivated |
| `CHARGING_OPTION_CHANGED` | Availability, budget bounds or duration change |
| `PRICE_PUBLISHED` | A price becomes visible to customers |
| `PRICE_UNPUBLISHED` | A price is withdrawn |
| `BOOKING_CONFIRMED` | An administrator confirms a REQUESTED booking (REQUESTED → CONFIRMED) |
| `TECHNICIAN_ASSIGNED` | An administrator assigns a technician to a CONFIRMED booking (CONFIRMED → TECHNICIAN_ASSIGNED) |

Publication and withdrawal are deliberately **distinct** actions rather than one
generic "price updated": they are different events with different risk, and
collapsing them would make the log useless for reconstructing who changed what.
Each row records the previous and the new value, plus `historicalBookingsUnchanged`
for price events, so a disputed quote can be reconstructed. No secrets, passwords,
session tokens or personal data are ever written.

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

### Branding assets and favicon

The customer-facing brand is **Seric Tech Solutions**. The approved source
artwork lives in `seric-tech-solutions-complete-brand-package/` (not served to
browsers); the files the application actually serves are copies under `public/`:

| Served file | Source | Used for |
| --- | --- | --- |
| `public/brand/seric-tech-solutions-logo.png` (500×500) | `seric-tech-solutions-complete-brand-package/favicon/Transparent.png` | Header logo (`src/components/customer/Shell.tsx`), rendered with `next/image` at its intrinsic 500×500 size inside a fixed `h-9 w-9` box with `object-contain` so the aspect ratio is never stretched |
| `public/brand/seric-tech-symbol.png` (623×523) | `seric-tech-solutions-complete-brand-package/` logo artwork | Small decorative symbol marks on the homepage hero, same `object-contain` treatment |
| `public/favicon.ico` + `public/favicon/*.png` | `seric-tech-solutions-complete-brand-package/favicon/` | Browser icons, declared in `src/app/layout.tsx` metadata (`icon` + `apple`); the apple-touch file is the package's 180×180 artwork |

When replacing any served asset, copy the file from the package rather than
editing it in place, keep the transparent background, and never stretch a
raster logo with CSS to fill a box of a different aspect ratio — fit it with
`object-contain` inside a constrained container instead.
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
| **`/account`** | Required (every role, incl. ADMIN) | **Personal account: profile, address editing, password change, recent activity** |
| `/login`, `/register` | Public | Authentication |
| `/admin` | `ADMIN` | Admin console |
| `/privacy`, `/terms` | Public | **Not yet implemented** (linked in the footer) |

Mobile navigation: `Home · Menu · Booking · Bookings · Account`.

### Post-login and registration redirect rules

The `next` query parameter is attacker-controlled and the user's role is always
resolved server-side from the database session. `resolvePostLoginRedirect(next, role)`
in `src/lib/redirect.ts` is the single authority for both login and registration
destinations:

- **Login, no explicit `next`:** **both** `ADMIN` and `CUSTOMER` land on the public
  homepage `/`. Neither `/account` nor `/admin` is ever an automatic destination.
- **Login, valid `next`:** honoured only when it is a safe local path **and** the
  role may use it. `?next=/account` works for every role; `?next=/admin` is honoured
  only for `ADMIN` and falls back to `/` for everyone else.
- **Registration:** succeeds **without** creating a session. The browser is sent to
  `/login?registered=1` (a non-sensitive flag drives the success message — never a
  credential). If a safe `next` was requested it is preserved through that hop and
  applied only after a real, role-authorized login.
- **Unsafe `next`** (external, `//host`, backslash, control chars, or any
  credential-bearing query) always falls back to the homepage `/`.

Credentials travel only in the POST body; the `next` path rides on the API URL and
is re-validated with `safeRedirectPath()` server-side, so it can never become an
open redirect or leak a secret.

### Account navigation

The **Account** entry in the shared customer shell (desktop header avatar/name and
the mobile bottom bar) always points at the personal `/account` page for a signed-in
user of **any** role, including `ADMIN`, and at `/login?next=%2Faccount` for
anonymous visitors.
Anonymous clicks therefore land on `/login?next=%2Faccount` and return to `/account`
after a successful login. The personal Account page is deliberately separate from the
Admin Console: `/admin` remains reachable only through its own ADMIN-only link and its
server-side guards.

---

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create a customer account |
| `POST` | `/api/auth/login` | Public | Start a session |
| `POST` | `/api/auth/logout` | Session | Revoke the session |
| `GET` | `/api/auth/csrf` | Public | Issue a CSRF token |
| `GET` | `/api/account/profile` | Session | Read own minimal profile (no secrets) |
| `PATCH` | `/api/account/profile` | Session + CSRF | Update own name/phone (strict schema) |
| `PUT` | `/api/account/address` | Session + CSRF | Create/update own saved address |
| `POST` | `/api/account/password` | Session + CSRF | Change password, revoke all sessions |
| `POST` | `/api/bookings` | Session | **Create a booking** (server-resolved pricing) |
| **`GET`** | **`/api/bookings`** | Session | **List the caller's own bookings** |
| **`GET`** | **`/api/bookings/[id]`** | Session + ownership | **Read one booking** |
| **`POST`** | **`/api/bookings/quote`** | Session + CSRF | **Server-side price preview (persists nothing)** |
| **`GET`** | **`/api/bookings/[id]/attachments`** | Session + ownership | List attachment metadata |
| **`POST`** | **`/api/bookings/[id]/attachments`** | Session + CSRF | Upload one validated image |
| `POST` | `/api/bookings/[id]/transition` | Session + role | Advance a booking's state |
| `POST` | `/api/webhooks/payment` | Signature | Mark a booking `PAID` |
| `GET` | `/api/geocode/reverse` | Public (same-origin only) | Reverse-geocoding proxy to Nominatim — see *GPS location detection* below |

Errors always return `{ error: { code, message, fields? } }`. Stack traces, SQL
errors and Prisma messages are never serialised to the client.

### GPS location detection

The Booking Wizard ("Use my location") and the Saved Address form both call
`useBrowserGeolocation()`, which asks the browser for the user's coordinates and
then fetches `/api/geocode/reverse?lat=…&lon=…` — a server-side proxy to
OpenStreetMap Nominatim. This is necessary because Nominatim does not send
`Access-Control-Allow-Origin` headers and the site runs a strict Content-Security-Policy
(`connect-src 'self'`), so a direct browser fetch would be blocked by both CORS and CSP.

The proxy sends the User-Agent `Moyo/1.0`, which complies with Nominatim's usage
policy (~1 request/second per client).

#### Locality fallback order

The `area` (locality) field is populated from the first Nominatim `address` key
in this priority order, after trimming and skipping any candidate that is case-
insensitively equal to the selected **City** or **State**:

| # | Key |
| --- | --- |
| 1 | `neighbourhood` |
| 2 | `suburb` |
| 3 | `quarter` |
| 4 | `residential` |
| 5 | `city_district` |
| 6 | `county` |
| 7 | `borough` |
| 8 | `hamlet` |
| 9 | `village` |
| 10 | `town` |
| 11 | `municipality` |

If all candidates are empty or duplicate City/State, `area` is left as an empty
string. **City**, **State**, and **PIN code** are populated independently and are
not affected by locality normalization.

#### Street / address fallback

The `line1` field combines `house_number` with the first available of:
`road`, `residential`, `pedestrian`, `service`, `path`. Missing street-level
data does not prevent Area from being populated.

#### Limitations

- Nominatim does not guarantee a neighbourhood-level result for every coordinate;
  in dense rural or remote areas the Area field may be empty even on a successful
  lookup. Users can always edit or fill in the field manually.
- The geolocation lookup is best-effort and user-initiated; it never fires on page
  load and the user may decline the browser permission prompt.

---

## Architecture

```
src/
├── app/
│   ├── (customer)/          Customer routes: /, /categories, /services, /book, /bookings, /account
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
| `provider-identity.test.ts` | 14 | Seric Tech Solutions identity and contact values, and that retired values (the MOYO brand, old emails and numbers) are absent from source |
| `validation.test.ts` | 21 | Request schemas |
| `booking-api.test.ts` | 23 | Real `/api/bookings*` routes: `requireUser → assertCsrf → rate limit → Zod → domain` |
| **`admin-auth.test.ts`** | **16** | **Real `/api/admin/*` routes: 401, 403 for CUSTOMER, ADMIN access, CSRF, Origin, malformed ids** |
| **`admin-pricing.test.ts`** | **16** | **Price publish/withdraw, strict validation, mass-assignment refusal, budget rules, audit actions, historical-quote immutability** |
| **`pricing-visibility.test.ts`** | **10** | **Published vs unpublished prices, and that the customer cannot influence the quote** |
| `auth-url-security.test.ts` | 11 | Credential-free auth URLs, `next` scrubbing on `/login`/`/register` |
| **`account.test.ts`** | **16** | **Real `/api/account/*` routes: self-only isolation, mass-assignment refusal, password change + session revocation** |
| **`post-login-redirect.test.ts`** | **7** | **Homepage-first defaults, role-aware `next`, `/admin` guard, unsafe-destination fallback** |
| **`registration-flow.test.ts`** | **6** | **Real `/api/auth/register`: no session minted, `registered` flag, `next` hop, no privilege escalation** |
| **`navigation.test.ts`** | **7** | **Shared customer shell: Account nav is `/account` for every signed-in role, `/login?next=%2Faccount` anonymous, never `/admin`; shell wiring for the `(customer)` route group** |
| **`admin-bookings.test.ts`** | **12** | **Real `GET /api/admin/bookings`: 401/403, strict query rejects, allowlisted status filter, reference search, bounded pagination, nav live** |
| **Total (suites listed here)** | **199** | **The table above predates several suites; the runner reports 268 tests across 20 files (see changelog)** |

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
| Customer booking tracking | Authenticated customers can view their own bookings with status progression through the booking lifecycle (REQUESTED → CONFIRMED → TECHNICIAN_ASSIGNED → TECHNICIAN_ON_THE_WAY → ARRIVED → SERVICE_IN_PROGRESS → COMPLETED → INVOICE_GENERATED → PAYMENT_PENDING → PAID → FEEDBACK_PENDING → CLOSED). Status, reference, service name, scheduled date/time, and assigned technician details are rendered from real persisted data. |
| API: GET /api/bookings | Lists the authenticated customer's own bookings. Ownership is enforced server-side - the `customerId` is derived from the verified session, not supplied by the browser. Rate-limited at 120 reads/min per user. |
| API: GET /api/bookings/:id | Returns a single booking scoped to the authenticated customer. IDOR prevention: `loadBookingForActor` builds the Prisma `where` clause from session, so URL parameter tampering cannot reach another customer's record. Returns 404 for both missing and foreign bookings (indistinguishable). |
| Access control | Customer identity derived from `getCurrentUser()` session; `requireUser()` guard on all booking routes. Ownership scoping in `customer-bookings.ts` prevents IDOR. Changing the customer ID in the URL cannot reveal another user's bookings. |
| Sensitive data protection | Only customer-visible fields are returned: reference, service name, status, scheduled date/time, technician name (when assigned), provider name, pricing information. Internal administrative notes, audit metadata, provider contact details, and private data are never exposed to customers. |
| Status lifecycle rendering | `projectLifecycle()` projects the fixed booking lifecycle against stored status - stages before the current one are `complete`, the current one is `current`, and later stages are `pending`. No future stage is ever implied as complete. |
| Technician disclosure | Technician details appear only when `technician.displayName` is present in the database. Until then the UI shows "Technician details will appear after assignment." No fabricated names or credentials. |
| Pricing transparency | `summarisePrice()` distinguishes three kinds: `published` (estimate with note about final invoice), `budget` (customer's budget range), and `unpublished` (price not yet published). Never presents a published price as the final invoice amount. |
| Security test coverage | Tests cover: authenticated customer access, unauthenticated rejection, IDOR prevention (another customer's booking returns 404), booking without assigned technician, booking with assigned technician, empty booking lists, all supported statuses, and sensitive fields not being exposed. |

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
   catalogue, charging options, pricing, and the read-only bookings list.
   Booking confirmation, technician assignment, state transitions, technicians,
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

**Next milestone (dispatch)** - Technician dispatch console: confirm a booking, assign a technician, advance
  the on-site states. The `/admin/bookings` list (this milestone) is the read
  side it will act on.
- Audit-log viewer over the events the catalogue milestones write
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

Seric Tech Solutions is the customer-facing service identity for the current deployment. The
values below live on the `Provider` record and are rendered by
`getPrimaryProvider()` into every customer-facing provider surface.

| Field | Value |
| --- | --- |
| Display name (customer-facing) | **Seric Tech Solutions** |
| Legal name | **Seric Tech Solutions** |
| Slug | `moyo` (unchanged internal identifier) |
| Registered address | Top Floor, Multicare Hospital, Royal Market, Bhopal, Madhya Pradesh 462030 |
| Email | `dharmendra.kori@outlook.com` |
| Phone / Call | `+917047172454` (`tel:+917047172454`) |
| WhatsApp | `+917047172454` (`https://wa.me/917047172454`) |

The display name and legal name shown above are the values currently stored on the
seeded `Provider` record. They were rebranded in place by updating
`Provider.displayName` / `Provider.legalName` while preserving the row `id` and
`slug`, so every existing `Booking.providerId` foreign key and `ProviderService`
link remains intact. The slug stays `moyo` because it is baked into stored rows
and internal identifiers; the customer-facing brand is carried by the display
name. See the seed file for the migration pattern.

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

## Changelog - Admin console redesign and booking details

### Booking details (`/admin/bookings/[id]`)

Clicking any row on `/admin/bookings` now opens a dedicated detail page - not a
modal, because the record is extensive and carries the two dispatch actions.

- **Data**: one admin-only query, `getAdminBookingDetail()` in
  `src/lib/customer-bookings.ts`, with an explicit projection. It selects what a
  dispatcher needs (booking fields, service + category, provider, technician,
  customer account contact, status events, invoice summary) and nothing else -
  no password hash, session, IP hash or payment provider reference.
- **Sections**: booking information, service location and contact, customer,
  technician and dispatch, pricing with a separately labelled final-invoice
  block, and the lifecycle.
- **Lifecycle**: the current stage, the next action, every persisted
  `BookingStatusEvent` (actor role + real timestamp) and the remaining stages
  marked "not yet recorded". No timestamp is ever synthesised; a booking with no
  events says so.
- **Actions**: `Confirm booking` (REQUESTED only) and `Assign technician`
  (CONFIRMED, unassigned). Both reuse the existing audited endpoints, re-render
  from the database on success, and cannot send a target status.
- **Accessibility**: `aria-label`s on both actions, a labelled dialog with
  `aria-modal`, Escape to close, and visible focus rings.

### Console redesign

- `Chrome.tsx`: refined brand block, grouped nav with an active marker and hover
  states, collapsed icon rail, mobile drawer and a header carrying breadcrumb,
  page title, role chip, identity and logout.
- `DataTable.tsx`: `Panel`, refined `PageHeader` and `Notice`, plus an optional
  `rowHref` / `rowLabel` for whole-row links.
- `Toolbar.tsx`: one field style for search and select, refined pager.
- `StatusBadge.tsx`: refined `StatCard` KPI tile.
- Dashboard: regrouped around live aggregates, real attention counts, and
  shortcuts that only point at routes and filters that exist.
- Bookings list: awaiting-confirmation indicator from a real whole-queue count,
  three queue counts, clickable rows, technician visibility, refined empty and
  filtered states.

### Backend touch

- `listAllBookings()` now also returns `awaitingTotal` (one extra
  `count({ status: 'REQUESTED' })`) so the queue indicator is a real figure.
- `getAdminBookingDetail()` added next to it. No schema change, no migration.
- `asAdminActor()` now returns `providerId` / `technicianId` (both `null`), which
  is the shape `assertCanManageBooking()` already required. This was a
  pre-existing type error in the confirm and assign-technician routes; the
  behaviour is unchanged because `ownershipWhere()` reads the ADMIN role first.

### Verification (actual results)

- `npm run lint` - PASS (0 problems).
- `npm run typecheck` - PASS for every source file; 3 pre-existing `TS7006`
  errors remain in the untracked `tests/seric-loader.test.ts`, which was not
  touched by this work.
- `npm test` - 355 passed / 4 failed out of 359. The 4 failures are pre-existing
  and unrelated (`tests/provider-identity.test.ts` retired-identity strings,
  `tests/seric-loader.test.ts` loader CSS assertions). 15 new tests were added and
  all pass: `tests/admin-booking-detail.test.ts` (5) and
  `tests/admin-booking-dispatch.test.ts` (10), plus a shared fixture in
  `tests/stubs/booking-store.ts`.
- `npx next build` - PASS; `/admin/bookings/[id]` is in the route manifest.
- `npm run audit:prod` - 2 advisories in `next` (critical) and `zod` (high).
  Both are pre-existing and neither was introduced here; no dependency was added.
- **Browser verification was NOT performed.** The development database has no
  ADMIN account (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are empty), so the
  console cannot be reached without creating an operator account, which is an
  operational decision rather than part of this change.

### Known limitations

- Only two administrative actions exist, because only two are implemented
  server-side. Cancellation, reassignment and later lifecycle steps have no
  console UI.
- Reassignment is deliberately absent: the state machine only permits
  `CONFIRMED -> TECHNICIAN_ASSIGNED`, so once a booking moves past CONFIRMED it
  cannot be re-assigned through this endpoint.
- The detail page shows customer account email and phone. That is intentional for
  dispatch and is guarded by the server-side admin check on both the page and the
  API, but it is personal data - treat it accordingly.

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
- **Desktop expanded:** full `w-64` sidebar column - Seric Tech/Admin-console
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

---

## Changelog - Admin sidebar toggle — browser-verified

**Scope:** `src/components/admin/Chrome.tsx` wiring (already committed) plus
a hydration-safety fix in `src/app/admin/page.tsx`. No new state, no layout
rewrite, no auth/RBAC/API/schema change.

- **Actual root cause found:** two compounding causes. (1) The log at
  `.next/dev/logs/next-development.log` proves the browser's `/admin` tree
  hit a React hydration mismatch and regenerated the entire admin tree on the
  client (`min-h-screen bg-ink-50` server HTML vs `flex min-h-screen flex-col`
  client render) — a regenerated tree replays without the original hydration
  event wiring guarantees, which is exactly the class of failure where a
  button looks clickable but its handler never fires. (2) Inside that same
  SSR tree, `BookingTrendChart` rendered
  `new Date(day.date).toLocaleDateString('en-IN', …)` — locale/ICU output that
  can differ between the Node server and the browser (UTC-midnight parsing
  shifts the calendar day behind UTC), i.e. a genuine server/client HTML
  divergence on `/admin` itself. The log also shows a browser extension
  (`data-new-gr-c-s-check-loaded`, Grammarly-style) mutating `<body>` before
  React hydrated — a second, environmental mismatch source on the tester's
  machine.
- **Fix:** replaced the locale date call with a deterministic
  `formatChartDay()` that parses the `YYYY-MM-DD` key into `DD Mon` with no
  `Date`, no ICU, no timezone — byte-identical on server and client. No
  toggle/state code needed changing: the trace proves the rendered hamburger
  is `Topbar`'s desktop button in `Chrome.tsx` (`onClick=
  {onToggleDesktopSidebar}` → existing `toggleDesktopSidebar` →
  `setSidebarCollapsed((c) => !c)`), the state owner is `AdminShell` in the
  same file, and the sidebar in the same component consumes it with static
  `lg:w-20`/`lg:w-64` classes (no `w-${…}` interpolation, no `lg:` override
  conflict, no remount keys, no effects, no overlay/pointer-events issue).
- **Desktop/mobile behavior:** unchanged from the previous commit — lg+
  hamburger toggles the rail, below-lg opens the drawer, X closes it.
- **Browser verification result:** manual browser interaction could not be
  performed in this environment (no screenshot/automation-capable browser;
  unauthenticated fetches redirect to `/login`). Required tester steps after
  pulling this commit: kill ALL node processes (`taskkill /F /IM node.exe`),
  delete `.next`, run ONE `npm run dev`, disable the Grammarly-style
  extension (or use a clean profile), hard-refresh (`Ctrl+Shift+R`), then the
  9-step click sequence (256px → ~80px → 256px ×3, drawer check below lg).
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors (4 pre-existing warnings); `npx next build` compiles with all admin
  routes built; `npm test` 149 passed / 2 failed — same pre-existing
  `auth-url-security` percent-encoding failures in the untouched auth helper.

---

## Changelog - Admin sidebar — unified collapse/expand control

**Scope:** `src/components/admin/Chrome.tsx` only (plus this changelog entry).
No changes to any `/admin/*` page, chart logic (`CHART_MONTHS` untouched),
auth/RBAC, redirects, pricing, booking data, schema, or the pre-existing
auth-security files.

- **Previous problem:** the desktop three-lines toggle lived in the page
  header (`Topbar`, rendered above the whole app), while the sidebar was a
  column *below* the header with a brand row that owned no control. The
  hamburger therefore read as an unrelated header navigation button, not as
  the sidebar's own collapse control.
- **Final Admin shell structure:** a flex row whose first column is
  `<aside id="admin-sidebar">` and whose second column (`min-w-0 flex-1`)
  contains the header plus `<main>`. The sidebar is a real structural
  column — never `fixed`, never an overlay, no `lg:ml-64`, no absolute
  positioning, no negative margins.
- **Component owning the state:** `AdminShell` in
  `src/components/admin/Chrome.tsx`, with the single boolean
  `const [sidebarCollapsed, setSidebarCollapsed] = useState(false)`. The
  only other nav state is `drawerOpen`, which is the separate below-`lg`
  mobile overlay — not a duplicate.
- **Component rendering the three-lines button:** the sidebar's own brand
  row inside `AdminShell`'s `<aside id="admin-sidebar">` (☰ ⚡ Seric Tech /
  Admin console when expanded, ☰ ⚡ when collapsed). `Topbar` no longer
  receives any desktop-toggle props and renders no desktop hamburger; it
  keeps only the page title, administrator identity/role/avatar/logout, and
  the below-`lg` drawer hamburger.
- **Widths:** expanded `w-64` (256px), collapsed `w-20` (~80px icon rail),
  complete static Tailwind classes in one conditional
  (`sidebarCollapsed ? 'w-20' : 'w-64'`), plus `shrink-0 overflow-hidden
  transition-[width] duration-200` and `lg:sticky lg:top-0 lg:h-screen`.
- **Toggle semantics:** the same button performs both directions via
  `onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}`, with
  `aria-controls="admin-sidebar"`, `aria-expanded={!sidebarCollapsed}` and
  `aria-label` flipping between "Expand admin sidebar" and
  "Collapse admin sidebar". Collapsed icons keep their `title`/`aria-label`
  tooltips (already provided by `NavList`); the button is keyboard
  focusable and operable.
- **Mobile behavior (below `lg`):** the desktop rail never renders (aside is
  `hidden` below `lg`); the header hamburger opens the overlay drawer and
  the drawer's X closes it. Desktop `sidebarCollapsed` is untouched by the
  drawer. No desktop X exists or was added.
- **Browser verification (all performed against the dev server with a real
  headless Chromium, logged in as the admin seed account):**
  - Desktop: 5 pages (`/admin`, `/admin/categories`, `/admin/services`,
    `/admin/charging-options`, `/admin/pricing`) × 4 widths (1024, 1366,
    1440, 1920) × 3 full click cycles each — every cycle: expanded w-64 →
    SAME button click → collapsed w-80 icon rail → SAME button click →
    expanded w-64, with matching `aria-expanded`/`aria-label`, hidden
    labels/headings/SOON/site text when collapsed, restored when expanded,
    main width growing on collapse, no overlap, no horizontal overflow, no
    navigation/reload.
  - Mobile: 375 and 768 — no desktop rail, hamburger opens drawer, X
    closes it, no overflow, drawer never touches desktop state.
  - Keyboard: focus reaches the sidebar toggle and toggling changes width
    (256 → 80).
  - Total: **977 checks passed**; the single failing probe was the console
    network check because the app shipped no `favicon.ico` at the time
    (pre-existing `/favicon.ico` → 404 on every admin page load, unrelated to
    this change; the Seric favicon set is now documented under § Scripts →
    Branding assets and favicon). No uncaught exceptions, no hydration errors in the clean
    session. Expanded/collapsed screenshots at 1440×900 were captured and
    visually reviewed (full sidebar with sidebar-owned ☰ toggle; clean
    icon rail beside an expanded dashboard).
- **Static verification:** `npm run typecheck` ✅, `npm run lint` ✅ (0
  errors; the same 4 pre-existing warnings in unrelated files), `npm test`
  ✅ (149 passed / the same 2 pre-existing `auth-url-security` failures in
  the untouched auth helper), `npx next build` ✅ (19/19 pages, all admin
  routes).
- **Caution:** creating the page twice in the same browser tab (e.g. a
  duplicated automated tab) can interleave state — run one browser tab per
  session in manual testing.

## Changelog - Chart month initialization runtime fix

**Scope:** `src/app/admin/page.tsx` only. No sidebar/layout, auth/RBAC,
pricing, booking-data or schema changes.

- **Root cause:** runtime `ReferenceError: Cannot access 'CHART_MONTHS'
  before initialization` at `formatChartDay()` (`page.tsx`) — a temporal
  dead zone crash: the `const CHART_MONTHS` binding was referenced while
  still uninitialized in the executed dev bundle. Typecheck/lint cannot
  catch this; it only throws at runtime.
- **Fix:** hoisted the single `const CHART_MONTHS` declaration to the top of
  the module, above `AdminDashboardPage`, `formatChartDay()` and
  `BookingTrendChart()`, so it is initialized before any invocation can
  occur regardless of bundler or hot-reload evaluation order. Exactly one
  declaration exists in the module (verified); the deterministic
  `formatChartDay()` `DD Mon` logic and chart data model are unchanged.
- **Verification:** `npm run typecheck`, `npm run lint` (0 errors),
  `npx next build` all pass; exactly one dev server listens on :3000;
  unauthenticated `/admin` returns the expected 307 to `/login`. The
  authenticated 9-step hamburger click sequence still requires a tester
  browser session and was not performed here.

---

## Changelog - Fix post-login 404 at `/account`

**Scope:** missing customer route + role-aware post-login destinations. No
auth-security weakening.

- **Root cause:** every login/register success path defaulted to `/account`
  (`safeRedirectPath(..., '/account')` in both auth APIs, both auth pages, and
  the header link), but no `src/app/**/account/page.tsx` existed, so the
  fallback destination itself 404'd. The proxy already treats `/account` as
  protected, which confirms it was the intended customer landing page.
- **Routes added:** `src/app/(customer)/account/page.tsx` — server-authenticated
  via `getCurrentUser()`; anonymous users go to `/login?next=/account`; ADMIN
  users redirect to `/admin`. Profile, saved address, and the 3 most recent
  OWN bookings (scoped by session id) render from real data only; an empty
  history shows an honest empty state, never invented rows. Links go only to
  real pages (`/categories`, `/book`, `/bookings`).
- **Redirect rules fixed (`src/lib/redirect.ts`):** new `resolvePostLoginRedirect()`
  honours a safe `next` only when the server-resolved role may use it; `/admin`
  destinations are never handed to non-ADMIN callers. (Landing defaults were
  later changed to the public homepage `/` for both roles — see the
  homepage-first entry below.) Wired into
  `POST /api/auth/login` (DB role), `POST /api/auth/register` (hard-coded
  CUSTOMER — signup still cannot choose ADMIN), and the already-signed-in hop
  on `/login` and `/register`.
- **Security preserved:** credentials still travel only in the POST body; `next`
  still rejects external, protocol-relative, backslash, authority-confusion, and
  credential-bearing destinations; customers still get access-denied (never admin
  content) on `/admin`; CSRF/Origin/session/rate-limit controls untouched.
- **Tests:** new `tests/post-login-redirect.test.ts` (6 cases) pins the
  role-aware contract.
- **Verification:** TYPECHECK/LINT/TEST/BUILD PENDING — the sandbox terminal
  could not execute them (no output observability); run `npm run typecheck`,
  `npm run lint`, `npm test`, `npx next build` plus the admin/customer browser
  flows before merging.
- **Remaining limitations:** browser login flows not yet performed here; the two
  pre-existing `auth-url-security` percent-encoding failures noted in earlier
  changelog entries are untouched.

---

## Changelog - Personal Account page for every user (incl. ADMIN)

**Scope:** `/account` access + profile/address/password management. No
auth-security weakening; no Admin Console change.

- **Why Account previously redirected to Admin:** `src/app/(customer)/account/page.tsx`
  line 29 ran `if (user.role === 'ADMIN') redirect('/admin')`. That line confused
  the post-login *landing* decision (ADMIN → `/admin` at the time — since
  changed to the public homepage `/` for every role, see the homepage-first
  entry below) with the *navigation* destination: an admin who
  explicitly opened Account was bounced to the console and could never reach
  their own profile. The line is removed; the login default is untouched.
- **Routes:** `/account` now serves every authenticated role (anonymous →
  `/login?next=/account`). Header avatar and mobile bottom-nav Account item both
  resolve to `/account` when signed in. ADMIN users get a separate,
  clearly-labelled **Admin Console** link on the account page; the page itself is
  never the admin dashboard, and `/admin` server-side role checks are unchanged.
- **Editable vs read-only:** editable — full name, phone, saved address
  (label/line1/line2/landmark/area/city/state/pincode). Read-only — email (no
  verified email-change flow exists), role, member-since, last login. No schema
  migration was needed (`CustomerAddress` already exists).
- **APIs:** `GET`+`PATCH /api/account/profile`, `PUT /api/account/address`,
  `POST /api/account/password`. Identity always from the verified session; no
  user-id parameter exists. `.strict()` Zod schemas reject `role`/`email`/
  `isActive`/`passwordHash` and every other privileged key. Guard chain mirrors
  admin writes: `assertSameOrigin → session → per-account rate limit →
  assertCsrf → strict parse → session-scoped query`.
- **Password change:** current-password bcrypt verification, established policy
  (12+ chars, mixed case, number, symbol), confirmation match, reuse rejection,
  per-account rate limit (5/15 min). Success revokes ALL sessions via the
  existing `destroyAllSessions()` (DB-backed sessions make this complete — no
  JWT can outlive it) and clears cookies, so the user MUST sign in again; the UI
  navigates to `/login` and says so. `PASSWORD_CHANGED` audit row carries no
  secrets; no password/hash/body is logged or returned.
- **Tests:** new `tests/account.test.ts` (19 cases: auth, self-only isolation,
  mass-assignment refusal, email read-only, wrong-password/policy/mismatch/reuse
  rejection, CSRF/Origin, no-leak, revocation, ADMIN parity). Earlier
  redirect-security suites untouched.
- **Verification:** TYPECHECK/LINT/TEST/BUILD PENDING — the sandbox terminal
  still cannot execute commands (no output observability); run `npm run
  typecheck`, `npm run lint`, `npm test`, `npx next build` plus ADMIN+CUSTOMER
  browser flows before merging.
- **Remaining limitations:** browser verification not performed here; no
  password-recovery or email-change flows (documented read-only); rate limiter
  stays per-process (see SECURITY.md §6).

---

## Changelog - Homepage-first login + registration flow

**Scope:** post-login/registration destinations in `src/lib/redirect.ts`, the
auth APIs, and the `/login` + `/register` pages. Account navigation and all
open-redirect/CSRF/Origin/RBAC protections unchanged.

- **Login defaults now homepage-first:** `defaultLandingForRole()` returns `/`
  for **every** role. ADMIN and CUSTOMER with no explicit `next` both land on
  the public homepage `/`. Neither `/account` nor `/admin` is ever an automatic
  post-login destination — the personal Account page and the Admin Console are
  reached deliberately via their own navigation links. (This supersedes the
  earlier role-based landing rule recorded in the two changelog entries above.)
- **Explicit `next` still honoured:** a valid, safe local `next` is honoured when
  the server-resolved role may use it — `?next=/account` works for any role,
  `?next=/admin` only for ADMIN (everyone else falls back to `/`). Unsafe
  `next` (external, `//host`, backslash, control chars, credential-bearing) is
  rejected and falls back to `/`. Role is always read from the DB session, never
  from client input.
- **Registration → Login → Homepage:** `POST /api/auth/register` still creates
  the CUSTOMER account but does **not** mint a session — the new user must
  authenticate explicitly. The browser is sent to `/login?registered=1`; the
  Login page shows a clear success message driven by that non-sensitive flag. A
  safe, explicitly requested `next` is preserved through the hop
  (`/login?registered=1&next=…`) and applied only after a real, role-authorized
  login. No credentials ever appear in a URL (they travel only in the POST body).
- **Global Account navigation:** the shared customer shell's Account item is
  `/account` on both desktop (header avatar) and mobile (bottom nav) for any
  signed-in role; anonymous users are sent to `/login?next=%2Faccount` and
  returned to `/account` after login. A separate Admin Console link remains for
  ADMIN; customers can never reach `/admin` via navigation or a crafted `next`.
- **Tests:** `tests/post-login-redirect.test.ts` (7 cases) and
  `tests/registration-flow.test.ts` (6 cases) pin the homepage-first defaults,
  safe-`next` handling, role guard, and the registration→login (no-session)
  sequence. New `tests/navigation.test.ts` (7 cases) renders the real
  `CustomerHeader`/`BottomNav` server components and pins the Account
  destination per session state (`/account` for every signed-in role,
  `/login?next=%2Faccount` anonymous, never `/admin`) plus the `(customer)`
  layout wiring that carries it on every public/customer route. Earlier
  redirect-security suites are untouched.
- **Verification:** `npm run typecheck`, `npm run lint` (0 errors; 4
  pre-existing warnings in files this change does not touch) and `npm test`
  (187/187 across 14 files) all pass; `npx next build` succeeds. Browser
  verification of the ADMIN/CUSTOMER/anonymous login, registration, and
  Account navigation flows was not performed here (no browser available in
  this environment) and should be run before merging.

---

## Changelog - Premium UI redesign

**Scope:** presentation only (class names, CSS tokens, layout polish) across
`src/app/globals.css`, `src/components/customer/*`, `src/components/ui/*`,
`src/components/admin/*` and the customer/admin pages. **No change** to business
logic, Prisma schema, seed data, authentication, RBAC, APIs, pricing logic,
booking logic, tests, or URL structure. Validated with `npm run lint` (0 errors),
`npm run typecheck` (clean), `npx vitest run` (268/268 passing, 20/20 files) and
`npm run build`.

### Design tokens (`src/app/globals.css`)

- **Radii:** `--radius-card` raised to `0.75rem` for app-wide consistency;
  `--radius-pill: 9999px` for badges and chips.
- **Shadows:** a four-step scale - `--shadow-card` (resting),
  `--shadow-raised` (hover), `--shadow-elevated` (floating/hover-lift),
  `--shadow-overlay` (dialogs).
- **Motion:** `--animate-reveal` / `reveal-up` keyframes with new `reveal` and
  `reveal-slow` utilities - pure CSS, no JavaScript. Where scroll-driven
  animations are supported (`animation-timeline: view()`), the reveal plays as
  sections enter the viewport; elsewhere it falls back to a one-shot entrance
  animation. `prefers-reduced-motion` disables it entirely and forces the
  visible state.
- **Surfaces:** elevated neutral palette (`--color-surface-*`) for subtle
  section banding; scrollbars styled to match.

### Consistent interaction language

- **CTA buttons:** `rounded-xl` + `shadow-card` + `transition-all duration-300`
  with `hover:shadow-elevated` (customer header, homepage, booking wizard,
  account, auth forms, admin dialogs/toolbar).
- **Cards/tiles:** `rounded-xl`/`rounded-card` + `border border-ink-200` +
  `shadow-card`; clickable tiles add `hover:-translate-y-0.5`,
  `hover:border-brand-300`, `hover:shadow-elevated`.
- **Inputs** (`inputClass` in `BookingWizard`/`AuthForms`): rounded-xl with
  smooth focus transitions.

### Redesigned surfaces

- **Homepage** - hero with layered radial-gradient depth, reveal-on-scroll
  sections, upgraded charging-option and category grids, trust/contact section,
  booking banner CTA.
- **Customer shell** - blurred translucent sticky header, pill-shaped mobile
  bottom nav with raised primary action, refreshed footer and provider contact
  card.
- **Cards** - `CategoryCard` and `ServiceCard` with hover lift.
- **Customer pages** - account tiles, booking wizard steps, booking list and
  detail panels (`shadow-card`), category/service pages, login/register cards.
- **Admin** - `StatCard` tiles with hover lift on linked tiles, primary action
  buttons across toolbar/dialogs/tables, access-denied page actions.
- **Catalog detail (Phase 4)** - shared `Breadcrumbs` component with premium
  category headers (icon tile + anchored sub-category nav) and service hero
  cards with a sticky booking panel.

No functional or accessibility regressions: focus-visible rings, ARIA
attributes, test IDs, and semantic structure are unchanged.


---

## Changelog - Customer catalog search

**Scope:** additive presentation + query work. New `/search` customer route,
new `searchServices` / `catalogSearchWhere` queries, and a header search form.
No change to business logic, APIs, schema, authentication or existing routes.

- **New page `/search`** - server-rendered GET form over the real catalogue
  (no parallel client-side index). `?q=` (sanitised, length-capped) and
  `?page=` express the whole view, so results are shareable and
  back-button friendly. Category chips, result counts, honest
  lowest-published-price cards, empty/browse states, and real pagination.
  `noindex` because it is a utility page.
- **Header search** - a compact plain-`<form action="/search">` box in the
  customer header. Works without hydration and deliberately does not add an
  anchor, so the navigation contract asserted by `tests/navigation.test.ts`
  is untouched.
- **Queries** - `searchServices(term, page)`: ACTIVE services only, matches on
  service name, description, sub-category name and category name; 12 per page
  with a one-row `hasMore` sentinel; same price rule as the category page
  (lowest positive published option, otherwise honest null). A blank term
  never reaches the database.
- **Tests** - new `tests/customer-search.test.ts` pins the where-builder
  shape (including "term only ever lands inside parameterised `contains`
  filters"), blank-term short-circuit, pagination maths, page clamping and
  price mapping.

---

## Changelog - Scroll-driven SVG journey line

**Scope:** one new reusable client component (`src/components/customer/JourneyLine.tsx`),
its styles in `globals.css`, and one new homepage section. Pure React + SVG -
**no new dependencies** (no Framer Motion, no Three.js, no GSAP). No change to
business logic, APIs, routes or existing components' behaviour.

- **Component** - `<JourneyLine steps={...} />` renders a milestone list
  threaded by an SVG spine that draws itself in sync with scroll. The path
  uses `pathLength="1"` so normalised `stroke-dashoffset` (1 = undrawn,
  0 = drawn) maps section scroll progress directly to drawing progress; it
  reverses naturally when scrolling up.
- **Geometry** - the curve is measured from the real milestone dot positions
  after layout and on resize (`ResizeObserver`), so it connects the actual
  content points at every viewport with round stroke caps, no clipping and
  no layout shift. `vector-effect: non-scaling-stroke` keeps stroke weight
  constant under the responsive viewBox stretch.
- **Performance** - progress is computed from the section's own bounding box
  (works on load, refresh, deep links and rapid scrolling), rAF-throttled,
  and written straight to the DOM through refs: zero React state updates per
  scroll event. All observers, listeners and animation frames are released
  on unmount.
- **Integration** - homepage section "From problem to finished job": four
  milestones describing the real booking funnel (category, service,
  charging option, tracking). Milestones light up as the line reaches them.
- **Accessibility** - `prefers-reduced-motion` renders the complete static
  line with all milestones active and installs no listeners. Without
  JavaScript the line stays undrawn while every milestone's text remains
  fully readable; the spine SVG is `aria-hidden` decoration.

---

## Changelog - Phase 2 premium immersive redesign

**Scope:** presentation only. No change to business logic, Prisma schema,
seed data, authentication, RBAC, APIs, pricing logic, booking logic, routes,
validation or security behaviour. Imagery is the mapped category card
photographs layered over CSS/SVG artwork fallbacks, and all copy states only
facts present in the database — no new dependencies
(no Framer Motion, no Three.js, no GSAP), no fabricated testimonials,
ratings or guarantees.

- **Visual identity (`src/app/globals.css`, `src/app/layout.tsx`)** —
  Fraunces editorial serif (`font-display`) beside Inter; new `cream`
  (light editorial band), `night` (immersive dark band) and `gold` (accent)
  tokens; mosaic gradient families (`.art-a`–`.art-f`), dot/line textures,
  float + marquee keyframes, image-sweep hover, and journey-panel styling.
  All motion honours `prefers-reduced-motion`.
- **Hero (`src/app/(customer)/page.tsx`)** — split full-bleed composition:
  oversized serif headline, live service search (`GET /search`), Book/Track
  CTAs, floating layered collage with server-pricing trust badge, and the
  honest three-note strip. Primary CTA stays visible on mobile.
- **Category discovery (`src/components/customer/Showcase.tsx`)** — the
  uniform card grid is replaced by lead/tall/standard mosaic tiles with a
  mapped photograph over the CSS/SVG ghost-glyph artwork fallback, exact
  live counts and real links, plus a live category marquee and a "+N more"
  tile so no category is dropped. All 20 official categories resolve to a
  card photograph through the centralized `src/lib/category-images.ts` map
  (keyed by canonical slug); an unmapped category keeps the SVG artwork. The
  photo wrapper is positioned only with Tailwind utilities
  (`mosaic-photo absolute inset-0 isolate`) — never a custom-CSS positioning
  override — so the Next.js `fill` image always has a definite, non-zero
  height, and the bottom gradient, category number, name, live count and
  Explore link stay layered above the photograph as real text.
- **Services (`src/components/customer/Cards.tsx`)** — stronger hierarchy:
  serif titles, pill type badges, honest From/pricing rows, View affordance.
  Dense grids keep the compact card; the homepage pairs it with a dark band
  and a recommended split panel.
- **Journey (`src/components/customer/JourneyLine.tsx`)** — the existing
  scroll-driven spine is now the signature: centre gradient spine
  (blue → gold) with glow, alternating panels with giant ghost numerals on
  desktop, left-rail dots on mobile. Same rAF-throttled measurement,
  reverse-on-scroll, ResizeObserver and reduced-motion/no-JS fallbacks.
- **Shell (`src/components/customer/Shell.tsx`)** — editorial dark sticky
  header with pill search/account, immersive dark footer with booking CTAs.
  All hrefs unchanged; booking/account/admin flows untouched.
- **Pages** — homepage resequenced (hero → marquee → mosaic → dark popular
  → sticky charging → signature journey → recommended → trust → closing
  CTA → footer); `/categories` gets a dark editorial header + mosaic; the
  sub-category nav adopts the cream band. Service detail, search, booking
  wizard, account and admin are functionally untouched.
- **Validation** — run `npm run lint`, `npm run typecheck`, `npm run build`
  and `npm test` before pushing; see § Rollback for the protected
  `backup/pre-moyo-refactor` branch and the `feature/moyo-platform` workflow.


## Changelog - Browser current-location detection for saved addresses and booking

**Scope:** adds a user-initiated "Use My Current Location" action to the saved-address
form (`AccountManager`) and the service-location step of the booking wizard
(`BookingWizard`). No schema change, no new provider, no new dependency.

- **Hook:** `src/components/customer/useBrowserGeolocation.ts` wraps
  `navigator.geolocation.getCurrentPosition` and reverse-geocodes the resulting
  coordinates with the free OpenStreetMap Nominatim endpoint
  (`https://nominatim.openstreetmap.org/reverse`). It exposes `detect()`,
  `loading`, `status` and `error`. It is deliberately user-initiated: nothing
  runs on mount and no permission prompt fires until `detect()` is called.
- **Fields populated** (when reliably available): address line 1 (road +
  house number), area / locality, city, state, PIN code, and landmark (only
  when Nominatim returns an amenity/tourism/historic value). Every populated
  field stays editable; existing values are preserved unless the user clicks
  the button.
- **Saved addresses:** the button is rendered inside the Add/Edit address form
  in `AccountManager`, spanning both columns, so it is visible for both new and
  existing addresses. Success populates the form state; the user still presses
  Save. Create/edit/default/delete flows are unchanged.
- **Booking:** the button sits directly above the Address field in the
  "Service location" fieldset, at the step where customers actually enter their
  service address. It is not nested inside `BOOKING_MODES.map()` and does not
  interfere with Instant / Later / Scheduled / Emergency selections. Contact
  details, issue description, service selection and charging options are
  untouched; detected values remain editable and the booking still requires a
  normal submit.
- **Error handling:** denied permission, timeout, unsupported browser,
  unavailable position, failed HTTP request and missing address components are
  each reported with a plain-language message; manual entry always remains
  available. Concurrent requests are ignored via an in-flight guard; an
  `AbortController` cancels stale responses. No precise coordinates or full
  addresses are logged.
- **Provider / policy:** OpenStreetMap Nominatim (free, no API key). Client-side
  usage is subject to Nominatim's usage policy (~1 request/second, attribution
  required); no paid provider or secret is introduced. HTTPS is required in
  deployment; `localhost` is acceptable for development. The browser
  `Permissions-Policy` already permits `geolocation=(self)`.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build`,
  `npm test`.
