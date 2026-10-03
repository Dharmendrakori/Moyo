import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
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
 * - SERIC TECH SOLUTIONS is seeded as the provider, using only the business
 *   details that were supplied (name, registered address, email, contacts).
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
 * SERIC TECH SOLUTIONS
 *
 * This is a PROVIDER on the Moyo platform, not the platform itself.
 *
 * Only the business details that were actually supplied to us are recorded.
 * Fields that would require verification (GSTIN, certifications, ratings,
 * ETAs, availability guarantees) are intentionally left NULL. The customer
 * UI renders neutral copy for any null value instead of inventing one.
 */
const SERIC_PROVIDER = {
  legalName: 'SERIC TECH SOLUTIONS',
  displayName: 'SERIC TECH SOLUTIONS',
  slug: 'seric-tech-solutions',
  description:
    'Service provider operating on the Moyo platform across the 20 official service categories, covering electrical, electronic, solar, plumbing and allied works.',
  registeredAddress: 'Top Floor, Multicare Hospital, Royal Market, Bhopal, Madhya Pradesh 462030',
  contactEmail: 'Seric.TechSolutions@gmail.com',
  contactPhone: '9993043078',
  whatsappNumber: '9993043078',
  // Not verified in this deployment - the UI must not claim verification.
  isVerified: false,
  isActive: true,
};

async function seedProvider() {
  console.log('Seeding provider: SERIC TECH SOLUTIONS...');

  const email = SERIC_PROVIDER.contactEmail.toLowerCase();
  const providerUser = await prisma.user.upsert({
    where: { email },
    update: { name: SERIC_PROVIDER.legalName, isActive: true },
    create: {
      email,
      // Unusable random password. This account is managed via password reset.
      // It can never be logged into with a known credential from the codebase.
      passwordHash: await bcrypt.hash(randomPassword(), 12),
      phone: SERIC_PROVIDER.contactPhone,
      name: SERIC_PROVIDER.legalName,
      role: 'PROVIDER',
      isActive: true,
    },
  });

  const provider = await prisma.provider.upsert({
    where: { userId: providerUser.id },
    update: {
      displayName: SERIC_PROVIDER.displayName,
      registeredAddress: SERIC_PROVIDER.registeredAddress,
      contactEmail: SERIC_PROVIDER.contactEmail,
      contactPhone: SERIC_PROVIDER.contactPhone,
      whatsappNumber: SERIC_PROVIDER.whatsappNumber,
      isActive: SERIC_PROVIDER.isActive,
    },
    create: {
      userId: providerUser.id,
      legalName: SERIC_PROVIDER.legalName,
      displayName: SERIC_PROVIDER.displayName,
      slug: SERIC_PROVIDER.slug,
      description: SERIC_PROVIDER.description,
      registeredAddress: SERIC_PROVIDER.registeredAddress,
      contactEmail: SERIC_PROVIDER.contactEmail,
      contactPhone: SERIC_PROVIDER.contactPhone,
      whatsappNumber: SERIC_PROVIDER.whatsappNumber,
      isVerified: SERIC_PROVIDER.isVerified,
      isActive: SERIC_PROVIDER.isActive,
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

function randomPassword(): string {
  // Node crypto is imported lazily to keep this file dependency-free at top.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  return randomBytes(32).toString('base64url');
}

/**
 * ADMIN BOOTSTRAP
 *
 * There is NO hard-coded admin password. An admin account is created only when
 * `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are provided in the
 * environment, and the password is never printed to the log.
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

  console.log('Seeding admin account...');
  await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', isActive: true },
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      phone: process.env.SEED_ADMIN_PHONE?.trim() || '9999999999',
      name: process.env.SEED_ADMIN_NAME?.trim() || 'Moyo Administrator',
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log(`  admin: ${email}`);
}

async function seedSettings() {
  const defaults: Array<[string, string]> = [
    ['platform.name', 'MOYO'],
    ['platform.currency', 'INR'],
    ['platform.taxRateBps', '1800'],
    ['support.email', 'Seric.TechSolutions@gmail.com'],
    ['support.phone', '9993043078'],
    ['booking.autoAssign', 'false'],
  ];
  for (const [key, value] of defaults) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
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