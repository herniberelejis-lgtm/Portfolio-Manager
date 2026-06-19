// Runs Prisma migrations during the build. Prisma migrations need a direct
// (non-pooled) connection, so we prefer the unpooled URL that the Vercel
// Storage (Neon) integration provides, falling back to a plain DATABASE_URL
// for local builds and simpler setups.
//
// If no database URL is present (e.g. the very first deploy used to create the
// Vercel project, before a database is connected), we skip migrations so the
// build can still succeed and the project gets created.
const { execSync } = require('child_process');

const directUrl =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL;

if (!directUrl) {
  console.log('[migrate] No database URL found in env — skipping migrations.');
  process.exit(0);
}

console.log('[migrate] Applying migrations with prisma migrate deploy...');
execSync('prisma migrate deploy', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: directUrl },
});
