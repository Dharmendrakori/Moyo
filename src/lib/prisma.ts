import 'server-only';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. Cached on globalThis so Next.js dev hot-reloads do not
 * open a new connection pool on every file change (which exhausts the DB).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}