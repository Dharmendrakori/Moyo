import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { CATEGORIES } from './catalog';
import { CHARGING_OPTIONS, type ServiceType } from '../src/lib/domain';

/**
 * DATABASE SEED
 *
 * Idempotent: safe to run repeatedly. Uses deterministic IDs where a
 * relationship must be stable, and upserts for everything else.
 *
 * WHAT IS AND IS NOT SEEDED:
 * - The 20 official categories and their sub-catalogues are seeded exactly as
 *   specified. Service names are specification-derived, not invented.
 * - MOYO is seeded as the current service provider, using only the business
 *   details that were supplied (identity, registered address, email, contacts).
 *   No ratings, certifications, ETAs or guarantees are fabricated.
 * - Admin credentials are created ONLY when SEED_ADMIN_PASSWORD is set in the
 *   environment. There is no hard-coded password anywhere in this repository.
 * - Material catalogue entries carry no prices unless supplied via
 *   SEED_MATERIAL_JSON, because inventing prices would misrepresent a business.
 */

const prisma = new PrismaClient();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Maps a specification service name to a ServiceType using an explicit
 * keyword allowlist. Anything unmatched falls back to SITE_VISIT rather than
 * guessing an operational classification.
 */
function inferServiceType(name: string): ServiceType {
  const n = name.toLowerCase();
  const rules: Array<[RegExp, ServiceType]> = [
    [/uninstall|removal|unmount/, 'UNINSTALLATION'],
    [/install|setup|erection|commission/, 'INSTALLATION'],
    [/maintenance|\bamc\b|preventive|cleaning|sanitiz/, 'MAINTENANCE'],
    [/replacement|replace\b/, 'REPLACEMENT'],
    [/consult|advisor|estimation|advice|supervision/, 'CONSULTATION'],
    [/spare|material|procure|sourcing/, 'SPARE_PARTS'],
    [/remote|online|call support/, 'REMOTE_SUPPORT'],
    [/custom|fabricat/, 'CUSTOMIZATION'],
    [/repair|fix|diagnos|service\b/, 'REPAIR'],
  ];
  for (const [re, type] of rules) {
    if (re.test(n)) return type;
  }
  return 'SITE_VISIT';
}

/**
 * Default included-work copy. Deliberately generic and operational - it
 * describes what a visit covers without promising outcomes or timeframes.
 */
const INCLUDED_WORK: Partial<Record<ServiceType, string>> = {
  REPAIR:
    'On-site diagnosis of the reported issue, corrective work, and functional testing before handback.',
  INSTALLATION: 'Site survey, installation of the new unit, connection and commissioning checks.',
  UNINSTALLATION: 'Safe disconnection, removal of the existing unit and site cleanup.',
  MAINTENANCE: 'Routine servicing, cleaning, safety checks and a condition report.',
  REPLACEMENT: 'Removal of the old unit, supply and fitting of the replacement, and testing.',
  SITE_VISIT: 'On-site inspection, assessment and a written recommendation.',
  CONSULTATION: 'Discussion of requirements, site assessment and an advisory recommendation.',
  SPARE_PARTS: 'Sourcing and supply of the requested material.',
  CUSTOMIZATION: 'Requirement discussion, design confirmation and custom execution.',
  REMOTE_SUPPORT: 'Remote diagnosis and guidance where the issue can be assessed remotely.',
};

async function seedCatalog() {
  console.log('Seeding service catalog (20 categories)...');

  for (const spec of CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { code: `cat-${spec.position}` },
      update: {
        name: spec.name,
        position: spec.position,
        description: spec.description,
        iconKey: spec.icon,
      },
      create: {
        code: `cat-${spec.position}`,
        position: spec.position,
        name: spec.name,
        slug: slugify(spec.name),
        description: spec.description,
        iconKey: spec.icon,
      },
    });

    for (const sub of spec.subcategories) {
      const subCategory = await prisma.subCategory.upsert({
        where: { categoryId_slug: { categoryId: category.id, slug: slugify(sub.name) } },
        update: { name: sub.name },
        create: {
          categoryId: category.id,
          name: sub.name,
          slug: slugify(sub.name),
        },
      });

      for (const serviceName of sub.services) {
        const slug = `${slugify(serviceName)}`;
        const serviceType = inferServiceType(serviceName);
        const service = await prisma.service.upsert({
          where: { slug },
          update: { name: serviceName, serviceType, subCategoryId: subCategory.id },
          create: {
            subCategoryId: subCategory.id,
            name: serviceName,
            slug,
            description: `${serviceName} - ${spec.description}`,
            includedWork: INCLUDED_WORK[serviceType] ?? INCLUDED_WORK.SITE_VISIT,
            serviceType,
          },
        });

        // Create the three charging options as INACTIVE with no price.
        // Prices are commercial decisions set by an admin in the admin panel;
        // seeding a number here would be fabricating a price.
        for (const charging of CHARGING_OPTIONS) {
          await prisma.serviceOption.upsert({
            where: { serviceId_charging: { serviceId: service.id, charging } },
            update: {},
            create: { serviceId: service.id, charging, isActive: false },
          });
        }
      }
    }
  }
  console.log(`  done: ${CATEGORIES.length} categories`);
}

/**
 * MOYO - the current customer-facing service provider.
 *
 * Only the business details that were actually supplied to us are recorded.
 * Fields that would require verification (GSTIN, certifications, ratings,
 * ETAs, availability guarantees) are intentionally left NULL. The customer
 * UI renders neutral copy for any null value instead of inventing one.
 *
 * IDENTITY: for the current deployment MOYO is the service identity customers
 * interact with. It is the value stored in `Provider.displayName` /
 * `legalName` and the value every customer-facing surface renders.
 */
const MOYO_PROVIDER = {
  legalName: 'MOYO',
  displayName: 'MOYO',
  slug: 'moyo',
  description:
    'Service provider operating across the 20 official service categories, covering electrical, electronic, solar, plumbing and allied works.',
  registeredAddress: 'Top Floor, Multicare Hospital, Royal Market, Bhopal, Madhya Pradesh 462030',
  contactEmail: 'dharmendra.kori@outlook.com',
  // Stored with the country code so `telLink()`/`whatsappLink()` produce the
  // correct international targets: tel:+917047172454 and wa.me/917047172454.
  contactPhone: '917047172454',
  whatsappNumber: '917047172454',
  // Not verified in this deployment - the UI must not claim verification.
  isVerified: false,
  isActive: true,
};

/**
 * Provider slugs used by earlier deployments of this seed.
 *
 * `Provider.slug` is `@unique` and is referenced by nothing else in the app, so
 * renaming it is safe - but only if the EXISTING row is migrated in place.
 * Upserting on the new slug alone would silently CREATE a second provider,
 * orphaning the first one's `ProviderService` links and `Booking.providerId`
 * foreign keys. `migrateLegacyProviderSlug()` moves the row instead, so every
 * relationship and the provider id survive the rename.
 */
const LEGACY_PROVIDER_SLUGS = ['seric-tech-solutions'] as const;

async function migrateLegacyProviderSlug(): Promise<void> {
  for (const legacy of LEGACY_PROVIDER_SLUGS) {
    if (legacy === MOYO_PROVIDER.slug) continue;

    const existing = await prisma.provider.findUnique({
      where: { slug: legacy },
      select: { id: true },
    });
    if (!existing) continue;

    // Only migrate if the target slug is free; otherwise the current row is
    // already correct and must not be disturbed.
    const target = await prisma.provider.findUnique({
      where: { slug: MOYO_PROVIDER.slug },
      select: { id: true },
    });
    if (target) continue;

    await prisma.provider.update({
      where: { id: existing.id },
      data: { slug: MOYO_PROVIDER.slug },
    });
    console.log(`  migrated provider slug "${legacy}" -> "${MOYO_PROVIDER.slug}" (id preserved)`);
  }
}

async function seedProvider() {
  console.log(`Seeding provider: ${MOYO_PROVIDER.displayName}...`);

  // Move any legacy-slug row onto the current slug BEFORE upserting, so the
  // rename preserves the provider id and all of its foreign keys instead of
  // creating a second provider row.
  await migrateLegacyProviderSlug();

  const email = MOYO_PROVIDER.contactEmail.toLowerCase();

  // The provider PROFILE is keyed on its slug, not on the owning user.
  //
  // Keying on `userId` (as this previously did) makes the seed depend on the
  // provider's contact email: change that email and the upsert looks for a
  // profile that does not exist, tries to CREATE one, and dies on the unique
  // `slug` constraint left behind by the previous run. The slug is the stable
  // business identity, so it is the correct key.
  //
  // The USER is still reconciled by email, and an existing provider user is
  // reused when one is already present, so re-seeding never orphans it.
  let providerUser = await prisma.user.findFirst({
    where: { role: 'PROVIDER' },
    // `email` is selected so the reconciliation warning below can report the
    // address this operator account actually signs in with.
    select: { id: true, email: true },
  });

  if (!providerUser) {
    providerUser = await prisma.user.upsert({
      where: { email },
      update: { name: MOYO_PROVIDER.legalName, isActive: true },
      create: {
        email,
        // Unusable random password. This account is managed via password reset.
        // It can never be logged into with a known credential from the codebase.
        passwordHash: await bcrypt.hash(randomPassword(), 12),
        // User.phone is @unique and stores a bare 10-digit number, so the
        // international form used for provider contact links is stripped here.
        phone: MOYO_PROVIDER.contactPhone.replace(/^91/, ''),
        name: MOYO_PROVIDER.legalName,
        role: 'PROVIDER',
        isActive: true,
      },
      select: { id: true, email: true },
    });
  } else {
    // Keep the owning account in step with the provider identity: display name,
    // phone and the authoritative contact email. Otherwise a provider account
    // created under a superseded address would keep that address forever, and
    // it is active login data.
    const emailTakenByOther = await prisma.user.findFirst({
      where: { email, NOT: { id: providerUser.id } },
      select: { id: true },
    });

    await prisma.user.update({
      where: { id: providerUser.id },
      data: {
        name: MOYO_PROVIDER.legalName,
        phone: MOYO_PROVIDER.contactPhone.replace(/^91/, ''),
        isActive: true,
        // `User.email` is @unique; only claim it when it is genuinely free.
        ...(emailTakenByOther ? {} : { email }),
      },
    });

    if (emailTakenByOther) {
      // The authoritative contact address already belongs to another account, so
      // it is NOT taken from them. The customer-facing contact details live on
      // the Provider record (correctly set above); this operator login keeps its
      // own address. Flagged because it is otherwise invisible.
      //
      // The retained ADDRESS is reported, not the record id: the operator needs
      // to know which login address this account actually uses in order to
      // authenticate with it, and an id is not usable for that.
      console.warn(
        `  note: provider account kept its existing login email ` +
          `("${providerUser.email}") - the authoritative contact email is already ` +
          `registered to another account and was not taken from it.`,
      );
    }
  }

  const provider = await prisma.provider.upsert({
    where: { slug: MOYO_PROVIDER.slug },
    update: {
      userId: providerUser.id,
      legalName: MOYO_PROVIDER.legalName,
      displayName: MOYO_PROVIDER.displayName,
      description: MOYO_PROVIDER.description,
      registeredAddress: MOYO_PROVIDER.registeredAddress,
      contactEmail: MOYO_PROVIDER.contactEmail,
      contactPhone: MOYO_PROVIDER.contactPhone,
      whatsappNumber: MOYO_PROVIDER.whatsappNumber,
      isVerified: MOYO_PROVIDER.isVerified,
      isActive: MOYO_PROVIDER.isActive,
    },
    create: {
      userId: providerUser.id,
      legalName: MOYO_PROVIDER.legalName,
      displayName: MOYO_PROVIDER.displayName,
      slug: MOYO_PROVIDER.slug,
      description: MOYO_PROVIDER.description,
      registeredAddress: MOYO_PROVIDER.registeredAddress,
      contactEmail: MOYO_PROVIDER.contactEmail,
      contactPhone: MOYO_PROVIDER.contactPhone,
      whatsappNumber: MOYO_PROVIDER.whatsappNumber,
      isVerified: MOYO_PROVIDER.isVerified,
      isActive: MOYO_PROVIDER.isActive,
    },
  });

  // Attach every active service to the provider so the catalog is bookable.
  // SQLite does not support createMany(skipDuplicates), so we filter to the
  // rows that do not already exist and then insert them.
  const services = await prisma.service.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const existing = await prisma.providerService.findMany({
    where: { providerId: provider.id },
    select: { serviceId: true },
  });
  const alreadyLinked = new Set(existing.map((e) => e.serviceId));
  const toLink = services
    .filter((s) => !alreadyLinked.has(s.id))
    .map((s) => ({ providerId: provider.id, serviceId: s.id }));

  if (toLink.length > 0) {
    // Chunked to stay well under SQLite's variable limit.
    const CHUNK = 200;
    for (let i = 0; i < toLink.length; i += CHUNK) {
      await prisma.providerService.createMany({ data: toLink.slice(i, i + CHUNK) });
    }
  }

  console.log(`  provider id: ${provider.id}`);
  console.log(`  linked services: ${toLink.length} newly, ${alreadyLinked.size} existing`);
  return provider;
}

/**
 * Generates an unusable random password for accounts that must exist before a
 * credential is issued (for example the seeded provider account, which is only
 * ever used via password reset). This can never be known to anyone reading the
 * repository.
 */
function randomPassword(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * ADMIN BOOTSTRAP
 *
 * There is NO hard-coded admin password. An admin account is created only when
 * `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are provided in the
 * environment, and the password is never printed to the log.
 *
 * PRIVILEGE-ESCALATION GUARD:
 * `User.email` is unique, so an upsert keyed on it will MATCH an existing account
 * and take the `update` branch - which would set `role: 'ADMIN'` on whatever
 * account already owned that address, while silently ignoring the supplied
 * password. In this deployment `dharmendra.kori@outlook.com` is a real CUSTOMER
 * account, so pointing `SEED_ADMIN_EMAIL` at it would hand that customer
 * administrator rights without anybody asking for it.
 *
 * This function therefore REFUSES to touch an address that already belongs to a
 * non-ADMIN account. An intentional promotion is possible, but only by opting in
 * explicitly with `SEED_ADMIN_ALLOW_PROMOTE=true`, which makes it a recorded
 * decision rather than an accident of a shared email address.
 *
 * The provider contact address is unaffected: `Provider.contactEmail` is a
 * display field and is independent of `User.email`, so an administrator does not
 * need to use it to sign in.
 */
async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('Skipping admin seed (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to enable).');
    return;
  }

  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
  }

  const allowPromote = process.env.SEED_ADMIN_ALLOW_PROMOTE === 'true';

  // Refuse to escalate an account that is not already an administrator.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, email: true },
  });

  if (existing && existing.role !== 'ADMIN' && !allowPromote) {
    throw new Error(
      `Refusing to seed an admin: the email "${email}" already belongs to an existing ` +
        `${existing.role} account.\n` +
        `Promoting it would silently grant administrator rights to that account and ` +
        `would ignore SEED_ADMIN_PASSWORD.\n` +
        `Choose a different, unused SEED_ADMIN_EMAIL. The provider contact address is ` +
        `only a display field - the admin login does not have to match it.\n` +
        `If this promotion is genuinely intended, re-run with ` +
        `SEED_ADMIN_ALLOW_PROMOTE=true.`,
    );
  }

  console.log('Seeding admin account...');

  if (existing) {
    // Already an ADMIN: refresh the credentials, do not touch anything else.
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await bcrypt.hash(password, 12), isActive: true },
    });
    console.log(`  admin: ${email} (existing admin, credentials refreshed)`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      phone: process.env.SEED_ADMIN_PHONE?.trim() || '9999999999',
      name: process.env.SEED_ADMIN_NAME?.trim() || 'Moyo Administrator',
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log(`  admin: ${email} (created)`);
}

async function seedSettings() {
  const defaults: Array<[string, string]> = [
    ['platform.name', 'MOYO'],
    ['platform.currency', 'INR'],
    ['platform.taxRateBps', '1800'],
    ['support.email', 'dharmendra.kori@outlook.com'],
    ['support.phone', '917047172454'],
    ['booking.autoAssign', 'false'],
  ];
  for (const [key, value] of defaults) {
    await prisma.setting.upsert({
      where: { key },
      // `update: { value }` is deliberate. With an empty update the row is only
      // ever created, so a superseded contact address written by an earlier
      // deployment would persist forever and stay live in the database.
      update: { value },
      create: { key, value },
    });
  }
  console.log('Seeded platform settings.');
}

async function main() {
  await seedCatalog();
  await seedProvider();
  await seedSettings();
  await seedAdmin();
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    // Seed output goes to the operator's terminal, not to any HTTP response.
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });