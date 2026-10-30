/// <reference types="vitest/globals" />

/**
 * INVOICE RULES AND PDF TESTS
 *
 * Pure-logic coverage for the financial subsystem: eligibility, integer
 * arithmetic, the reconciliation guard, snapshot handling and the PDF renderer.
 * No database is involved - these are the invariants, not the transport.
 */

import {
  assessInvoiceEligibility,
  buildCustomerSnapshot,
  buildInvoiceLine,
  buildSellerSnapshot,
  calculateInvoiceTotals,
  joinAddress,
  parseCustomerSnapshot,
  parseSellerSnapshot,
  type InvoiceSource,
} from '../src/lib/invoice';
import {
  escapePdfText,
  formatMinorUnits,
  renderInvoicePdf,
  type InvoicePdfDocument,
} from '../src/lib/invoice-pdf';
import { INVOICE_NUMBER_PREFIX, INVOICE_TAX_RATE_BPS } from '../src/lib/invoice';
import { findAdminNavItem } from '../src/lib/admin-nav';
import { adminInvoiceQuerySchema } from '../src/lib/validation';

const eligibleSource: InvoiceSource = {
  status: 'COMPLETED',
  charging: 'FIXED_CHARGE',
  quotedPaise: 149_900,
  hasInvoice: false,
  hasSeller: true,
};

function document(overrides: Partial<InvoicePdfDocument> = {}): InvoicePdfDocument {
  return {
    number: 'SERIC-INV-2026-000001',
    statusLabel: 'Issued',
    issuedAt: new Date('2026-10-30T09:00:00Z'),
    bookingReference: 'SERIC-2026-000123',
    seller: {
      name: 'Seric Tech Solutions',
      legalName: 'Seric Tech Solutions',
      address: 'Royal Market, Bhopal, Madhya Pradesh 462030',
      email: 'hello@example.com',
      phone: '917047172454',
      gstin: null,
    },
    customer: {
      name: 'Asha Verma',
      contactName: 'Asha Verma',
      contactPhone: '9876543210',
      address: '12 Test Street, Indiranagar, Bengaluru, Karnataka, 560038',
    },
    lines: [
      {
        description: 'AC Repair',
        chargingLabel: 'Fixed Charge',
        quantity: 1,
        unitPaise: 149_900,
        amountPaise: 149_900,
      },
    ],
    subtotalPaise: 149_900,
    taxPaise: 0,
    totalPaise: 149_900,
    currency: 'INR',
    ...overrides,
  };
}

const asText = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('invoice eligibility', () => {
  it('allows a completed booking with a confirmed price and a seller', () => {
    expect(assessInvoiceEligibility(eligibleSource)).toEqual({ eligible: true });
  });

  it('refuses every status the state machine does not route into invoicing', () => {
    for (const status of [
      'REQUESTED',
      'CONFIRMED',
      'TECHNICIAN_ASSIGNED',
      'TECHNICIAN_ON_THE_WAY',
      'ARRIVED',
      'SERVICE_IN_PROGRESS',
      'INVOICE_GENERATED',
      'PAYMENT_PENDING',
      'PAID',
      'FEEDBACK_PENDING',
    ]) {
      const result = assessInvoiceEligibility({ ...eligibleSource, status });
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.code).toBe('NOT_COMPLETED');
    }
  });

  it('refuses a closed and a cancelled booking', () => {
    for (const status of ['CLOSED', 'CANCELLED']) {
      const result = assessInvoiceEligibility({ ...eligibleSource, status });
      expect(result.eligible).toBe(false);
      if (!result.eligible) {
        expect(result.code).toBe('NOT_COMPLETED');
        expect(result.reason).toContain('cannot be invoiced');
      }
    }
  });

  it('refuses a second invoice for the same booking', () => {
    const result = assessInvoiceEligibility({ ...eligibleSource, hasInvoice: true });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe('ALREADY_INVOICED');
  });

  it('refuses a customer-budget booking, which has no confirmed final amount', () => {
    const result = assessInvoiceEligibility({
      ...eligibleSource,
      charging: 'CUSTOMER_BUDGET',
      quotedPaise: null,
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.code).toBe('NO_CONFIRMED_PRICE');
      expect(result.reason).toContain('final agreed amount');
    }
  });

  it('refuses zero, negative and out-of-range amounts', () => {
    for (const quotedPaise of [0, -1, 10_000_000_00 + 1]) {
      const result = assessInvoiceEligibility({ ...eligibleSource, quotedPaise });
      expect(result.eligible).toBe(false);
    }
  });

  it('refuses a booking with no seller attached', () => {
    const result = assessInvoiceEligibility({ ...eligibleSource, hasSeller: false });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe('NO_SELLER');
  });

describe('financial arithmetic', () => {
  it('builds a line whose total is exactly unit price x quantity', () => {
    const line = buildInvoiceLine({
      serviceName: 'AC Repair',
      charging: 'FIXED_CHARGE',
      quotedPaise: 149_900,
    });
    expect(line).toEqual({
      description: 'AC Repair',
      charging: 'FIXED_CHARGE',
      quantity: 1,
      unitPaise: 149_900,
      amountPaise: 149_900,
    });
    expect(line.amountPaise).toBe(line.unitPaise * line.quantity);
  });

  it('rejects a zero, negative, fractional or unsafe unit price', () => {
    for (const quotedPaise of [0, -1, 10.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() =>
        buildInvoiceLine({ serviceName: 'X', charging: 'FIXED_CHARGE', quotedPaise }),
      ).toThrow();
    }
  });

  it('sums line totals into the subtotal and applies no tax', () => {
    const lines = [
      { description: 'A', charging: 'FIXED_CHARGE', quantity: 1, unitPaise: 1, amountPaise: 1 },
      { description: 'B', charging: 'VISIT_CHARGE', quantity: 3, unitPaise: 33_333, amountPaise: 99_999 },
    ];
    const totals = calculateInvoiceTotals(lines);
    expect(totals.subtotalPaise).toBe(100_000);
    expect(totals.taxPaise).toBe(0);
    expect(totals.totalPaise).toBe(100_000);
    // The schema default used to be 18%; that would fabricate a tax liability.
    expect(INVOICE_TAX_RATE_BPS).toBe(0);
  });

  it('keeps precision on awkward paise amounts (no float drift)', () => {
    const lines = Array.from({ length: 3 }, () => ({
      description: 'Line',
      charging: 'FIXED_CHARGE',
      quantity: 1,
      unitPaise: 33_333,
      amountPaise: 33_333,
    }));
    const totals = calculateInvoiceTotals(lines);
    expect(totals.subtotalPaise).toBe(99_999);
    expect(totals.subtotalPaise).toBe(3 * 33_333);
  });

  it('refuses a line whose amount does not reconcile with price x quantity', () => {
    expect(() =>
      calculateInvoiceTotals([
        { description: 'A', charging: 'FIXED_CHARGE', quantity: 2, unitPaise: 500, amountPaise: 500 },
      ]),
    ).toThrow();
  });

  it('refuses invalid quantities and prices', () => {
    expect(() =>
      calculateInvoiceTotals([
        { description: 'A', charging: 'FIXED_CHARGE', quantity: 0, unitPaise: 500, amountPaise: 0 },
      ]),
    ).toThrow();
    expect(() =>
      calculateInvoiceTotals([
        { description: 'A', charging: 'FIXED_CHARGE', quantity: 1, unitPaise: 0, amountPaise: 0 },
      ]),
    ).toThrow();
  });

  it('refuses an empty invoice rather than issuing a zero-value document', () => {
    expect(() => calculateInvoiceTotals([])).toThrow();
  });
});

describe('snapshots', () => {
  it('snapshots only the seller details that exist, inventing no registration', () => {
    const seller = buildSellerSnapshot({
      displayName: 'Seric Tech Solutions',
      legalName: 'Seric Tech Solutions',
      registeredAddress: 'Royal Market, Bhopal',
      contactEmail: null,
      contactPhone: '917047172454',
      gstin: null,
    });
    expect(seller).toEqual({
      name: 'Seric Tech Solutions',
      legalName: 'Seric Tech Solutions',
      address: 'Royal Market, Bhopal',
      email: null,
      phone: '917047172454',
      gstin: null,
    });
  });

  it('joins only the address parts that exist', () => {
    expect(joinAddress(['1 Test St', null, 'Indiranagar', 'Bengaluru', '', '560038'])).toBe(
      '1 Test St, Indiranagar, Bengaluru, 560038',
    );
  });

  it('snapshots the booking contact and service address', () => {
    const customer = buildCustomerSnapshot({
      contactName: 'Asha Verma',
      contactPhone: '9876543210',
      addressLine1: '12 Test Street',
      addressLine2: null,
      area: 'Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    });
    expect(customer.address).toBe('12 Test Street, Indiranagar, Bengaluru, Karnataka, 560038');
    expect(customer.name).toBe('Asha Verma');
  });

  it('degrades gracefully when a stored snapshot is missing or unreadable', () => {
    expect(parseSellerSnapshot(null)).toEqual({});
    expect(parseSellerSnapshot('not json')).toEqual({});
    expect(parseSellerSnapshot('[1,2]')).toEqual({});
    expect(parseCustomerSnapshot('{"name":"Kept"}')).toEqual({ name: 'Kept' });
  });
});


describe('money formatting', () => {
  it('formats integer paise as a currency amount with two decimals', () => {
    expect(formatMinorUnits(149_900)).toBe('INR 1,499.00');
    expect(formatMinorUnits(100_000)).toBe('INR 1,000.00');
    expect(formatMinorUnits(123_456)).toBe('INR 1,234.56');
    expect(formatMinorUnits(0)).toBe('INR 0.00');
    expect(formatMinorUnits(1)).toBe('INR 0.01');
    expect(formatMinorUnits(1_000_000)).toBe('INR 10,000.00');
  });

  it('never uses the rupee glyph, which a standard Type1 font cannot draw', () => {
    expect(formatMinorUnits(149_900)).not.toContain('₹');
  });
});

describe('PDF rendering', () => {
  it('produces a structurally valid PDF file', () => {
    const text = asText(renderInvoicePdf(document()));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Page');
    expect(text).toContain('xref');
    expect(text).toContain('trailer');

    // startxref must point at the actual xref table, or readers reject the file.
    const startXref = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    expect(text.slice(startXref, startXref + 4)).toBe('xref');
  });

  it('carries the invoice number, booking reference and every monetary value', () => {
    const text = asText(renderInvoicePdf(document()));
    expect(text).toContain('SERIC-INV-2026-000001');
    expect(text).toContain('SERIC-2026-000123');
    expect(text).toContain('INR 1,499.00');
    expect(text).toContain('SERIC TECH SOLUTIONS');
    expect(text).toContain('Asha Verma');
    expect(text).toContain('AC Repair');
    expect(text).toContain('Issued');
  });

  it('renders the persisted total exactly, without recomputing it', () => {
    const text = asText(renderInvoicePdf(document()));
    // 149_900 paise appears as the unit price, the line amount and the total.
    expect(text.split('INR 1,499.00').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('omits a tax line and states plainly that no tax was applied', () => {
    const text = asText(renderInvoicePdf(document()));
    expect(text).not.toContain('(Tax)');
    expect(text).toContain('No tax has been applied');
    expect(text).toContain('No tax registration is configured');
  });

  it('shows a tax line only when a tax amount exists', () => {
    const text = asText(
      renderInvoicePdf(document({ taxPaise: 27_000, totalPaise: 176_900, subtotalPaise: 149_900 })),
    );
    expect(text).toContain('(Tax)');
    expect(text).toContain('INR 270.00');
    expect(text).toContain('INR 1,769.00');
  });

  it('prints a configured tax registration and never invents one', () => {
    expect(asText(renderInvoicePdf(document()))).not.toContain('GSTIN');
    const withGstin = asText(
      renderInvoicePdf(document({ seller: { ...document().seller, gstin: '23ABCDE1234F1Z5' } })),
    );
    expect(withGstin).toContain('GSTIN 23ABCDE1234F1Z5');
  });


  it('handles missing optional fields without failing', () => {
    const text = asText(
      renderInvoicePdf(
        document({
          issuedAt: null,
          seller: {
            name: 'Seric Tech Solutions',
            legalName: null,
            address: null,
            email: null,
            phone: null,
            gstin: null,
          },
          customer: { name: 'Asha Verma', contactName: '', contactPhone: '', address: '' },
        }),
      ),
    );
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('SERIC-INV-2026-000001');
  });

  it('escapes user-supplied text so it cannot inject content-stream operators', () => {
    const hostile = 'Fix (AC) \\ unit ) Tj ET 0 0 Td (injected';
    const text = asText(
      renderInvoicePdf(
        document({
          lines: [
            {
              description: hostile,
              chargingLabel: 'Fixed Charge',
              quantity: 1,
              unitPaise: 100,
              amountPaise: 100,
            },
          ],
        }),
      ),
    );

    // Parentheses and backslashes inside the literal are escaped...
    expect(text).toContain('\\(AC\\)');
    expect(text).toContain('\\\\');
    // ...so the raw injected operator sequence never appears.
    expect(text).not.toContain(') Tj ET 0 0 Td (injected');
  });

  it('strips control characters and non-Latin glyphs the standard font cannot draw', () => {
    expect(escapePdfText('a\u0000b\nc\u001fd')).toBe('a b c d');
    expect(escapePdfText('₹1,200')).toBe('?1,200');
    expect(escapePdfText('ok (fine) \\ done')).toBe('ok \\(fine\\) \\\\ done');
  });

  it('is deterministic for the same snapshot', () => {
    expect(asText(renderInvoicePdf(document()))).toBe(asText(renderInvoicePdf(document())));
  });

  it('does not leak server paths or internal identifiers into the document', () => {
    const text = asText(renderInvoicePdf(document()));
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('prisma');
    expect(text).not.toContain('C:\\');
    expect(text).not.toContain('/api/');
  });
});

describe('invoice numbering and query defaults', () => {
  it('uses a distinguishable, year-scoped prefix', () => {
    expect(INVOICE_NUMBER_PREFIX).toBe('SERIC-INV');
    // Booking references use the bare SERIC prefix; invoices must not collide.
    expect(INVOICE_NUMBER_PREFIX).not.toBe('SERIC');
  });

  it('defaults the admin invoice query safely', () => {
    expect(adminInvoiceQuerySchema.parse({})).toEqual({ status: 'ALL', page: 1, pageSize: 20 });
    expect(adminInvoiceQuerySchema.parse({ status: 'ISSUED', page: '2' })).toMatchObject({
      status: 'ISSUED',
      page: 2,
    });
  });

  it('rejects unknown keys, free-form statuses and unbounded paging', () => {
    for (const bad of [{ sort: 'desc' }, { status: 'PAID_ISH' }, { page: 0 }, { pageSize: 1000 }]) {
      expect(adminInvoiceQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('marks Invoices live now that the screen exists', () => {
    expect(findAdminNavItem('/admin/invoices')).toMatchObject({
      href: '/admin/invoices',
      status: 'live',
    });
  });
});

});
