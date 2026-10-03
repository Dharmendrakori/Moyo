// Generates a local .env for development and prints it. Run once: node scripts/setup-env.mjs
// This file is only ever run by a developer on their own machine.
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const target = '.env';
if (existsSync(target)) {
  console.log('.env already exists - not overwriting.');
  process.exit(0);
}

const secret = randomBytes(48).toString('base64');

const contents = `# LOCAL DEVELOPMENT ONLY - this file is gitignored.
# Never commit real credentials. In production use your hosting platform's
# secret manager instead.

DATABASE_URL="file:./dev.db"
SESSION_SECRET="${secret}"
APP_URL="http://localhost:3000"

# Payment provider is intentionally empty in development.
# While empty, checkout endpoints return 503 instead of faking a payment.
PAYMENT_PROVIDER=""
PAYMENT_WEBHOOK_SECRET=""

RATE_LIMIT_STORE="memory"
UPLOAD_DIR="./storage/uploads"
MAX_UPLOAD_MB="5"

# Optional: create an admin account when running the seed.
# Leave blank to skip. Never commit a real admin password.
SEED_ADMIN_EMAIL=""
SEED_ADMIN_PASSWORD=""
`;

writeFileSync(target, contents, { flag: 'wx' });
console.log('Created .env with a freshly generated SESSION_SECRET.');