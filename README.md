# Portfolio Tracker

A self-hosted portfolio tracker for Argentine brokerage accounts. Import transaction exports from multiple brokers (Cocos Capital, Bull Market, PPI), and get a consolidated weighted-average-cost P&L view with live price syncing.

## Features

- **Multi-broker CSV/XLSX import** — auto-detects and parses exports from Cocos Capital, Bull Market, and PPI, with per-row error isolation so one bad row doesn't abort the whole file.
- **Weighted-average-cost P&L engine** — tracks cost basis and realized/unrealized gains per position using BigInt cents to avoid floating-point drift.
- **Live price sync** — pulls current quotes from [data912.com](https://data912.com) for Argentine equities.
- **Dashboard** — holdings breakdown, portfolio evolution over time, and P&L by asset, built with Recharts.
- **Auth** — email/password accounts via NextAuth credentials provider, bcrypt-hashed.

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- Prisma ORM (SQLite by default, swap `DATABASE_URL` for Postgres in production)
- NextAuth for authentication
- Vitest + `@vitest/coverage-v8` for testing
- Recharts for data visualization
- ExcelJS for `.xlsx` parsing

## Getting Started

```bash
npm install
cp .env.example .env   # fill in NEXTAUTH_SECRET, DATABASE_URL, etc.
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), register an account, and import a CSV/XLSX export from a supported broker on the portfolio page.

## Testing

```bash
npx vitest run --coverage
```

Minimum coverage threshold: 80% (statements/branches/functions/lines).

## Project Structure

```
src/
  app/                # Next.js routes (auth pages, portfolio dashboard, API routes)
  lib/csv/            # Per-broker parsers + registry that auto-detects format
  lib/pnl/            # Weighted-average-cost P&L engine and portfolio view builder
  lib/market/         # Live price client and sync job
prisma/               # Schema and migrations
tests/                # Unit tests (mirrors src/ structure)
docs/superpowers/     # Original design spec and implementation plan
```

## License

MIT
