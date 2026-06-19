import { PrismaClient } from '@prisma/client';

// Resolve the database URL from whichever env var is available. A plain
// DATABASE_URL covers local dev and most providers; the POSTGRES_* names are
// what the Vercel Storage (Neon) integration injects automatically, so the app
// works once the database is connected in Vercel without setting anything by
// hand. Prefer pooled URLs at runtime (better for serverless).
function resolveDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING
  );
}

const databaseUrl = resolveDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
  );

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
