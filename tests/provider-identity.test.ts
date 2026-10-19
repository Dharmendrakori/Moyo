/// <reference types="vitest/globals" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { telLink, whatsappLink } from '../src/lib/format';

/**
 * PROVIDER IDENTITY AND CONTACT TESTS
 *
 * The customer-facing service identity and its contact details are seeded in
 * `prisma/seed.ts` and rendered from the `Provider` record. These tests pin the
 * authoritative values so a later edit cannot silently reintroduce a retired
 * brand or an old number.
 *
 * Scope notes:
 * - `legacy/index.html` is the preserved pre-refactor page. It is excluded from
 *   the build, lint and typecheck and is intentionally left byte-for-byte
 *   intact as historical evidence, so it is NOT scanned here.
 * - The seed is asserted by reading its source rather than executing it:
 *   `prisma/seed.ts` calls `main()` at module scope, so importing it would run
 *   the seed as a side effect of the test run.
 */

/** The current, authoritative identity and contact details. */
const EXPECTED = {
  displayName: 'Seric Tech Solutions',
  slug: 'moyo',
  email: 'dharmendra.kori@outlook.com',
  /** Stored with the country code so link builders emit the right target. */
  phone: '917047172454',
  international: '+917047172454',
  whatsappUrl: 'https://wa.me/917047172454',
  address: 'Top Floor, Multicare Hospital, Royal Market, Bhopal, Madhya Pradesh 462030',
};

/**
 * Values that must not survive anywhere in active application data or copy.
 * The brand names are matched case-sensitively on purpose: lowercase `moyo`
 * remains allowed as a legacy internal identifier (provider slug, cookie
 * names, signature header), while the display brand must read "Seric Tech
 * Solutions" everywhere a customer or operator can see it.
 */
const RETIRED = [
  'MOYO',
  'Moyo',
  'Seric.TechSolutions@gmail.com',
  'seric.techsolutions@gmail.com',
  '9993043078',
  '9575616213',
];

const SEED_SOURCE = readFileSync(join(process.cwd(), 'prisma', 'seed.ts'), 'utf8');

/** Recursively collects source files, skipping build output and dependencies. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx|json|prisma)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('provider identity (seeded data)', () => {
  it('seeds Seric Tech Solutions as the provider display and legal name', () => {
    expect(SEED_SOURCE).toContain("displayName: 'Seric Tech Solutions'");
    expect(SEED_SOURCE).toContain("legalName: 'Seric Tech Solutions'");
    // The slug stays `moyo`: it is baked into stored rows and internal identifiers.
    expect(SEED_SOURCE).toContain("slug: 'moyo'");
  });

  it('seeds the authoritative contact email', () => {
    expect(SEED_SOURCE).toContain(`contactEmail: '${EXPECTED.email}'`);
    expect(SEED_SOURCE).toContain(`['support.email', '${EXPECTED.email}']`);
  });

  it('seeds the authoritative phone for BOTH call and WhatsApp', () => {
    expect(SEED_SOURCE).toContain(`contactPhone: '${EXPECTED.phone}'`);
    expect(SEED_SOURCE).toContain(`whatsappNumber: '${EXPECTED.phone}'`);
    expect(SEED_SOURCE).toContain(`['support.phone', '${EXPECTED.phone}']`);
  });

  it('keeps the supplied registered address unchanged', () => {
    expect(SEED_SOURCE).toContain(EXPECTED.address);
  });

  it('does not retain any retired identity or contact value', () => {
    for (const value of RETIRED) {
      expect(SEED_SOURCE, `seed still contains retired value "${value}"`).not.toContain(value);
    }
  });

  it('migrates a legacy provider slug in place instead of creating a duplicate', () => {
    // The legacy slug is referenced ONLY by the migration allowlist. If it were
    // also the upsert key, re-seeding would create a second provider row and
    // orphan the first one's service links and booking foreign keys.
    expect(SEED_SOURCE).toContain("const LEGACY_PROVIDER_SLUGS = ['seric-tech-solutions']");
    expect(SEED_SOURCE).toContain('migrateLegacyProviderSlug()');
    // Keyed on the current slug, never on the legacy one.
    expect(SEED_SOURCE).toContain('where: { slug: SERIC_PROVIDER.slug }');
  });

  it('updates seeded settings rather than only creating them', () => {
    // `update: {}` would leave a superseded address live in the database
    // forever, because the row would never be rewritten.
    expect(SEED_SOURCE).toContain('update: { value }');
  });
});

describe('contact link generation', () => {
  it('builds the required Call target', () => {
    expect(telLink(EXPECTED.phone)).toBe(`tel:${EXPECTED.international}`);
  });

  it('builds the required WhatsApp target', () => {
    const link = whatsappLink(EXPECTED.phone, 'Hello');
    expect(link).not.toBeNull();
    expect(link).toContain(EXPECTED.whatsappUrl);
  });

  it('produces the same number for Call and WhatsApp', () => {
    const tel = telLink(EXPECTED.phone) ?? '';
    const wa = whatsappLink(EXPECTED.phone, 'Hello') ?? '';
    expect(tel.replace('tel:+', '')).toBe(wa.split('/')[3]?.split('?')[0]);
  });

  it('refuses to build a link from an unusable number', () => {
    expect(telLink(null)).toBeNull();
    expect(whatsappLink('123', 'Hello')).toBeNull();
  });
});

describe('active application code and copy', () => {
  const files = [
    ...collectSourceFiles(join(process.cwd(), 'src')),
    ...collectSourceFiles(join(process.cwd(), 'prisma')),
    join(process.cwd(), 'package.json'),
  ];

  it('exposes no retired identity or contact value', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const value of RETIRED) {
        if (contents.includes(value)) offenders.push(`${file}: ${value}`);
      }
    }
    expect(offenders, `retired values still present:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('does not scan the preserved legacy page', () => {
    // Guards the guard: legacy/index.html is historical evidence and must stay
    // byte-for-byte intact, so the scan above must never cover it.
    expect(files.some((f) => f.includes(join('legacy', 'index.html')))).toBe(false);
  });

  it('presents Seric Tech Solutions consistently in customer-facing provider copy', () => {
    const wizard = readFileSync(
      join(process.cwd(), 'src', 'components', 'customer', 'BookingWizard.tsx'),
      'utf8',
    );
    expect(wizard).toContain('Seric Tech Solutions is the service identity you are booking');
    expect(wizard).toContain('place this booking with Seric Tech Solutions');
  });
});
