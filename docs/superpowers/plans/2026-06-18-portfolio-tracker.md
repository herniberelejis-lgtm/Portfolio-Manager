# Portfolio Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-user web app that imports broker CSV transactions (Cocos Capital, Bull Market), tracks real-time market prices, computes weighted-average-cost P&L, and shows a portfolio dashboard — behind username/password login.

**Architecture:** Next.js (App Router) + TypeScript monorepo-style single app. PostgreSQL via Prisma ORM. NextAuth credentials provider for auth. A `BrokerParser` interface normalizes broker-specific CSVs into a shared `Transaction` model. A scheduled job fetches prices from data912 into `PriceSnapshot`. A pure-function P&L engine computes positions/gains from `Transaction` + `PriceSnapshot`. Dashboard pages call internal API routes that assemble portfolio view-models.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma + PostgreSQL, NextAuth (credentials + bcrypt), Vitest for unit tests, Playwright for E2E, Recharts for charts.

## Global Constraints

- All passwords hashed with bcrypt, never stored/logged in plaintext.
- Every Prisma query that touches user-owned data MUST filter by `userId` — no cross-user data leakage.
- CSV import must be idempotent: re-uploading the same file must not create duplicate `Transaction` rows (enforced via `rowHash` unique constraint).
- `fondeo` and `retiro` transaction types are excluded from P&L gain/loss calculations (they are capital movements, not investment performance).
- Money amounts stored as integers in minor units (cents) to avoid floating-point drift; `Decimal` in Prisma schema, never `Float`.
- Minimum 80% test coverage per project testing standards.
- No hardcoded secrets; all config (DB URL, NextAuth secret) via environment variables.

---

## File Structure

```
src/
  app/
    (auth)/
      login/page.tsx
      register/page.tsx
    (dashboard)/
      layout.tsx
      portfolio/page.tsx
    api/
      auth/[...nextauth]/route.ts
      broker-accounts/route.ts
      transactions/import/route.ts
      portfolio/route.ts
  lib/
    auth.ts                  # NextAuth config
    prisma.ts                 # Prisma client singleton
    csv/
      types.ts                # BrokerParser interface, Transaction DTO
      hash.ts                  # rowHash computation
      cocosParser.ts
      bullMarketParser.ts
      parserRegistry.ts        # detects broker from headers, dispatches
    market/
      data912Client.ts         # fetches prices from data912 API
      exchangeRateClient.ts    # fetches ARS/USD MEP rate
      priceSyncJob.ts           # orchestrates PriceSnapshot updates
    pnl/
      engine.ts                 # pure functions: weighted avg cost, realized/unrealized P&L
    portfolio/
      buildPortfolioView.ts     # combines Transaction + PriceSnapshot + ExchangeRate into view-model
  components/
    portfolio/
      PortfolioSummaryCards.tsx
      PositionsTable.tsx
      PnlChart.tsx
      CurrencyToggle.tsx
    csv/
      CsvUploadForm.tsx
      ImportPreviewTable.tsx
prisma/
  schema.prisma
tests/
  unit/
    csv/cocosParser.test.ts
    csv/bullMarketParser.test.ts
    csv/hash.test.ts
    pnl/engine.test.ts
    portfolio/buildPortfolioView.test.ts
  e2e/
    portfolio-flow.spec.ts
  fixtures/
    cocos-sample.csv
    bullmarket-sample.csv
```

---

### Task 1: Project scaffold + Prisma schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `.env.example`
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Test: `tests/unit/prisma-schema.test.ts`

**Interfaces:**
- Produces: Prisma Client types `User`, `BrokerAccount`, `Transaction`, `Asset`, `PriceSnapshot`, `ExchangeRate` (all later tasks import from `@prisma/client` and `src/lib/prisma.ts`'s exported `prisma` singleton).

- [ ] **Step 1: Initialize Next.js + TypeScript project**

```bash
npx create-next-app@14 . --typescript --app --no-tailwind --no-eslint --src-dir --import-alias "@/*"
```

- [ ] **Step 2: Install dependencies**

```bash
npm install prisma @prisma/client next-auth bcrypt csv-parse recharts decimal.js
npm install -D vitest @vitejs/plugin-react playwright @types/bcrypt
```

- [ ] **Step 3: Write `.env.example`**

```env
DATABASE_URL="postgresql://user:password@localhost:5432/portfolio_tracker"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
DATA912_BASE_URL="https://data912.com"
```

- [ ] **Step 4: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String         @id @default(cuid())
  email         String         @unique
  passwordHash  String
  createdAt     DateTime       @default(now())
  brokerAccounts BrokerAccount[]
}

model BrokerAccount {
  id           String        @id @default(cuid())
  userId       String
  user         User          @relation(fields: [userId], references: [id])
  broker       String        // "cocos" | "bullmarket"
  label        String
  createdAt    DateTime      @default(now())
  transactions Transaction[]

  @@index([userId])
}

model Asset {
  id        String   @id @default(cuid())
  ticker    String   @unique
  assetType String   // "stock" | "cedear" | "bond" | "fci"
  currency  String   // "ARS" | "USD"

  transactions  Transaction[]
  priceSnapshots PriceSnapshot[]
}

model Transaction {
  id              String   @id @default(cuid())
  brokerAccountId String
  brokerAccount   BrokerAccount @relation(fields: [brokerAccountId], references: [id])
  assetId         String?
  asset           Asset?   @relation(fields: [assetId], references: [id])
  date            DateTime
  type            String   // "buy" | "sell" | "dividend" | "deposit" | "withdrawal" | "fee"
  quantity        Decimal? @db.Decimal(20, 8)
  price           Decimal? @db.Decimal(20, 8)
  currency        String
  amountCents     BigInt
  rawRow          Json
  rowHash         String   @unique
  createdAt       DateTime @default(now())

  @@index([brokerAccountId])
  @@index([assetId])
}

model PriceSnapshot {
  id        String   @id @default(cuid())
  assetId   String
  asset     Asset    @relation(fields: [assetId], references: [id])
  priceCents BigInt
  currency  String
  fetchedAt DateTime @default(now())

  @@index([assetId, fetchedAt])
}

model ExchangeRate {
  id        String   @id @default(cuid())
  rateType  String   // "oficial" | "mep" | "ccl"
  date      DateTime
  rateCents BigInt   // ARS cents per 1 USD

  @@unique([rateType, date])
}
```

- [ ] **Step 5: Write `src/lib/prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 6: Generate Prisma client and verify schema is valid**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json next.config.js .env.example prisma/schema.prisma src/lib/prisma.ts
git commit -m "feat: scaffold Next.js project and Prisma schema"
```

---

### Task 2: Auth (NextAuth credentials + bcrypt)

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register/page.tsx`
- Create: `src/app/api/register/route.ts`
- Test: `tests/unit/auth/register.test.ts`

**Interfaces:**
- Consumes: `prisma` from `src/lib/prisma.ts` (Task 1).
- Produces: `authOptions` (NextAuth config object) exported from `src/lib/auth.ts`, used by later tasks to read `session.user.id` in API routes via `getServerSession(authOptions)`.

- [ ] **Step 1: Write failing test for password hashing on register**

```typescript
// tests/unit/auth/register.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/register/route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('POST /api/register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hashes the password before storing the user', async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockImplementation(({ data }: any) => ({
      id: 'user_1',
      email: data.email,
      passwordHash: data.passwordHash,
    }));

    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'sup3rSecret!' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.user.email).toBe('test@example.com');
    expect(body.user.passwordHash).not.toBe('sup3rSecret!');
    const isValidHash = await bcrypt.compare('sup3rSecret!', body.user.passwordHash);
    expect(isValidHash).toBe(true);
  });

  it('rejects registration if email already exists', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'existing' });

    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'sup3rSecret!' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth/register.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/register/route'"

- [ ] **Step 3: Write `src/app/api/register/route.ts`**

```typescript
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (!email || !password || password.length < 8) {
    return Response.json({ error: 'Invalid email or password too short' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: 'Email already registered' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash },
  });

  return Response.json({ user: { id: user.id, email: user.email, passwordHash: user.passwordHash } }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/auth/register.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `src/lib/auth.ts`**

```typescript
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).id = token.userId;
      return session;
    },
  },
  pages: { signIn: '/login' },
};
```

- [ ] **Step 6: Write `src/app/api/auth/[...nextauth]/route.ts`**

```typescript
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

- [ ] **Step 7: Write `src/app/(auth)/login/page.tsx`**

```tsx
'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await signIn('credentials', { email, password, redirect: false });
    if (result?.error) {
      setError('Email o contraseña incorrectos');
      return;
    }
    router.push('/portfolio');
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" required />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Entrar</button>
    </form>
  );
}
```

- [ ] **Step 8: Write `src/app/(auth)/register/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? 'Error al registrarse');
      return;
    }
    router.push('/login');
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (min 8 caracteres)" required minLength={8} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Crear cuenta</button>
    </form>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth.ts src/app/api/auth src/app/api/register src/app/\(auth\) tests/unit/auth
git commit -m "feat: add credentials auth with bcrypt password hashing"
```

---

### Task 3: CSV parser interface, row hashing, and Cocos Capital parser

**Files:**
- Create: `src/lib/csv/types.ts`
- Create: `src/lib/csv/hash.ts`
- Create: `src/lib/csv/cocosParser.ts`
- Create: `tests/fixtures/cocos-sample.csv`
- Test: `tests/unit/csv/hash.test.ts`
- Test: `tests/unit/csv/cocosParser.test.ts`

**Interfaces:**
- Produces: `ParsedTransaction` type, `BrokerParser` interface, `computeRowHash(row: ParsedTransaction): string`, `cocosParser: BrokerParser` — all consumed by Task 4 (Bull Market parser), Task 5 (parser registry / import endpoint).

- [ ] **Step 1: Write `src/lib/csv/types.ts`**

```typescript
export type TransactionType = 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'fee';

export interface ParsedTransaction {
  date: Date;
  type: TransactionType;
  ticker: string | null; // null for deposit/withdrawal/fee with no associated asset
  quantity: number | null;
  price: number | null;
  currency: 'ARS' | 'USD';
  amountCents: bigint;
  rawRow: Record<string, string>;
}

export interface BrokerParser {
  brokerId: string;
  /** Returns true if the CSV headers match this broker's export format. */
  detect(headers: string[]): boolean;
  parse(csvContent: string): ParsedTransaction[];
}
```

- [ ] **Step 2: Write failing test for row hashing**

```typescript
// tests/unit/csv/hash.test.ts
import { describe, it, expect } from 'vitest';
import { computeRowHash } from '@/lib/csv/hash';
import type { ParsedTransaction } from '@/lib/csv/types';

const baseRow: ParsedTransaction = {
  date: new Date('2026-01-15'),
  type: 'buy',
  ticker: 'GGAL',
  quantity: 10,
  price: 5000,
  currency: 'ARS',
  amountCents: 5000000n,
  rawRow: { foo: 'bar' },
};

describe('computeRowHash', () => {
  it('produces the same hash for identical rows', () => {
    const hash1 = computeRowHash(baseRow);
    const hash2 = computeRowHash({ ...baseRow });
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes when amount differs', () => {
    const hash1 = computeRowHash(baseRow);
    const hash2 = computeRowHash({ ...baseRow, amountCents: 9999n });
    expect(hash1).not.toBe(hash2);
  });

  it('ignores rawRow content (only uses normalized fields)', () => {
    const hash1 = computeRowHash(baseRow);
    const hash2 = computeRowHash({ ...baseRow, rawRow: { totally: 'different' } });
    expect(hash1).toBe(hash2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/csv/hash.test.ts`
Expected: FAIL with "Cannot find module '@/lib/csv/hash'"

- [ ] **Step 4: Write `src/lib/csv/hash.ts`**

```typescript
import { createHash } from 'crypto';
import type { ParsedTransaction } from './types';

export function computeRowHash(row: ParsedTransaction): string {
  const key = [
    row.date.toISOString(),
    row.type,
    row.ticker ?? '',
    row.quantity ?? '',
    row.price ?? '',
    row.currency,
    row.amountCents.toString(),
  ].join('|');

  return createHash('sha256').update(key).digest('hex');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/csv/hash.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Create fixture `tests/fixtures/cocos-sample.csv`**

```csv
Fecha,Tipo,Ticker,Cantidad,Precio,Moneda,Importe
2026-01-15,Compra,GGAL,10,5000.00,ARS,50000.00
2026-01-20,Venta,GGAL,5,5500.00,ARS,27500.00
2026-02-01,Ingreso de fondos,,,,ARS,100000.00
2026-02-10,Dividendo,GGAL,,,ARS,1200.00
```

- [ ] **Step 7: Write failing test for Cocos parser**

```typescript
// tests/unit/csv/cocosParser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { cocosParser } from '@/lib/csv/cocosParser';

const sampleCsv = readFileSync(path.join(process.cwd(), 'tests/fixtures/cocos-sample.csv'), 'utf-8');

describe('cocosParser', () => {
  it('detects Cocos headers', () => {
    expect(cocosParser.detect(['Fecha', 'Tipo', 'Ticker', 'Cantidad', 'Precio', 'Moneda', 'Importe'])).toBe(true);
    expect(cocosParser.detect(['Date', 'Type', 'Symbol'])).toBe(false);
  });

  it('parses a buy row correctly', () => {
    const rows = cocosParser.parse(sampleCsv);
    const buy = rows[0];
    expect(buy.type).toBe('buy');
    expect(buy.ticker).toBe('GGAL');
    expect(buy.quantity).toBe(10);
    expect(buy.price).toBe(5000);
    expect(buy.currency).toBe('ARS');
    expect(buy.amountCents).toBe(5000000n);
  });

  it('parses a sell row correctly', () => {
    const rows = cocosParser.parse(sampleCsv);
    const sell = rows[1];
    expect(sell.type).toBe('sell');
    expect(sell.quantity).toBe(5);
  });

  it('maps "Ingreso de fondos" to deposit with null ticker', () => {
    const rows = cocosParser.parse(sampleCsv);
    const deposit = rows[2];
    expect(deposit.type).toBe('deposit');
    expect(deposit.ticker).toBeNull();
    expect(deposit.amountCents).toBe(10000000n);
  });

  it('maps "Dividendo" to dividend type', () => {
    const rows = cocosParser.parse(sampleCsv);
    const dividend = rows[3];
    expect(dividend.type).toBe('dividend');
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run tests/unit/csv/cocosParser.test.ts`
Expected: FAIL with "Cannot find module '@/lib/csv/cocosParser'"

- [ ] **Step 9: Write `src/lib/csv/cocosParser.ts`**

```typescript
import { parse } from 'csv-parse/sync';
import type { BrokerParser, ParsedTransaction, TransactionType } from './types';

const COCOS_HEADERS = ['Fecha', 'Tipo', 'Ticker', 'Cantidad', 'Precio', 'Moneda', 'Importe'];

const TYPE_MAP: Record<string, TransactionType> = {
  Compra: 'buy',
  Venta: 'sell',
  Dividendo: 'dividend',
  'Ingreso de fondos': 'deposit',
  'Retiro de fondos': 'withdrawal',
  Comisión: 'fee',
};

function toCents(value: string): bigint {
  const normalized = value.trim().replace(',', '.');
  return BigInt(Math.round(parseFloat(normalized) * 100));
}

export const cocosParser: BrokerParser = {
  brokerId: 'cocos',

  detect(headers: string[]): boolean {
    return COCOS_HEADERS.every((h) => headers.includes(h));
  },

  parse(csvContent: string): ParsedTransaction[] {
    const records: Record<string, string>[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    return records.map((row) => {
      const type = TYPE_MAP[row['Tipo'].trim()];
      if (!type) {
        throw new Error(`Cocos parser: unknown transaction type "${row['Tipo']}"`);
      }

      return {
        date: new Date(row['Fecha']),
        type,
        ticker: row['Ticker']?.trim() ? row['Ticker'].trim() : null,
        quantity: row['Cantidad']?.trim() ? parseFloat(row['Cantidad']) : null,
        price: row['Precio']?.trim() ? parseFloat(row['Precio']) : null,
        currency: row['Moneda'].trim() as 'ARS' | 'USD',
        amountCents: toCents(row['Importe']),
        rawRow: row,
      };
    });
  },
};
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run tests/unit/csv/cocosParser.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 11: Commit**

```bash
git add src/lib/csv/types.ts src/lib/csv/hash.ts src/lib/csv/cocosParser.ts tests/fixtures/cocos-sample.csv tests/unit/csv/hash.test.ts tests/unit/csv/cocosParser.test.ts
git commit -m "feat: add CSV parser interface, row hashing, and Cocos Capital parser"
```

---

### Task 4: Bull Market parser + parser registry

**Files:**
- Create: `src/lib/csv/bullMarketParser.ts`
- Create: `src/lib/csv/parserRegistry.ts`
- Create: `tests/fixtures/bullmarket-sample.csv`
- Test: `tests/unit/csv/bullMarketParser.test.ts`
- Test: `tests/unit/csv/parserRegistry.test.ts`

**Interfaces:**
- Consumes: `BrokerParser`, `ParsedTransaction` from `src/lib/csv/types.ts` (Task 3); `cocosParser` from `src/lib/csv/cocosParser.ts` (Task 3).
- Produces: `bullMarketParser: BrokerParser`; `detectAndParse(csvContent: string): { brokerId: string; transactions: ParsedTransaction[] }` from `parserRegistry.ts`, consumed by Task 5 (import endpoint).

- [ ] **Step 1: Create fixture `tests/fixtures/bullmarket-sample.csv`**

```csv
Date,Operation,Symbol,Qty,Price,Currency,Total
2026-01-15,BUY,GGAL,10,5000.00,ARS,50000.00
2026-01-20,SELL,GGAL,5,5500.00,ARS,27500.00
2026-02-01,DEPOSIT,,,,ARS,100000.00
2026-02-10,DIVIDEND,GGAL,,,ARS,1200.00
```

- [ ] **Step 2: Write failing test for Bull Market parser**

```typescript
// tests/unit/csv/bullMarketParser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { bullMarketParser } from '@/lib/csv/bullMarketParser';

const sampleCsv = readFileSync(path.join(process.cwd(), 'tests/fixtures/bullmarket-sample.csv'), 'utf-8');

describe('bullMarketParser', () => {
  it('detects Bull Market headers', () => {
    expect(bullMarketParser.detect(['Date', 'Operation', 'Symbol', 'Qty', 'Price', 'Currency', 'Total'])).toBe(true);
    expect(bullMarketParser.detect(['Fecha', 'Tipo'])).toBe(false);
  });

  it('parses a buy row correctly', () => {
    const rows = bullMarketParser.parse(sampleCsv);
    expect(rows[0].type).toBe('buy');
    expect(rows[0].ticker).toBe('GGAL');
    expect(rows[0].amountCents).toBe(5000000n);
  });

  it('maps DEPOSIT to deposit type with null ticker', () => {
    const rows = bullMarketParser.parse(sampleCsv);
    expect(rows[2].type).toBe('deposit');
    expect(rows[2].ticker).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/csv/bullMarketParser.test.ts`
Expected: FAIL with "Cannot find module '@/lib/csv/bullMarketParser'"

- [ ] **Step 4: Write `src/lib/csv/bullMarketParser.ts`**

```typescript
import { parse } from 'csv-parse/sync';
import type { BrokerParser, ParsedTransaction, TransactionType } from './types';

const BULLMARKET_HEADERS = ['Date', 'Operation', 'Symbol', 'Qty', 'Price', 'Currency', 'Total'];

const TYPE_MAP: Record<string, TransactionType> = {
  BUY: 'buy',
  SELL: 'sell',
  DIVIDEND: 'dividend',
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  FEE: 'fee',
};

function toCents(value: string): bigint {
  return BigInt(Math.round(parseFloat(value.trim()) * 100));
}

export const bullMarketParser: BrokerParser = {
  brokerId: 'bullmarket',

  detect(headers: string[]): boolean {
    return BULLMARKET_HEADERS.every((h) => headers.includes(h));
  },

  parse(csvContent: string): ParsedTransaction[] {
    const records: Record<string, string>[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    return records.map((row) => {
      const type = TYPE_MAP[row['Operation'].trim()];
      if (!type) {
        throw new Error(`Bull Market parser: unknown operation "${row['Operation']}"`);
      }

      return {
        date: new Date(row['Date']),
        type,
        ticker: row['Symbol']?.trim() ? row['Symbol'].trim() : null,
        quantity: row['Qty']?.trim() ? parseFloat(row['Qty']) : null,
        price: row['Price']?.trim() ? parseFloat(row['Price']) : null,
        currency: row['Currency'].trim() as 'ARS' | 'USD',
        amountCents: toCents(row['Total']),
        rawRow: row,
      };
    });
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/csv/bullMarketParser.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Write failing test for parser registry**

```typescript
// tests/unit/csv/parserRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { detectAndParse } from '@/lib/csv/parserRegistry';

const cocosCsv = readFileSync(path.join(process.cwd(), 'tests/fixtures/cocos-sample.csv'), 'utf-8');
const bullCsv = readFileSync(path.join(process.cwd(), 'tests/fixtures/bullmarket-sample.csv'), 'utf-8');

describe('detectAndParse', () => {
  it('detects Cocos CSV and parses with cocosParser', () => {
    const result = detectAndParse(cocosCsv);
    expect(result.brokerId).toBe('cocos');
    expect(result.transactions).toHaveLength(4);
  });

  it('detects Bull Market CSV and parses with bullMarketParser', () => {
    const result = detectAndParse(bullCsv);
    expect(result.brokerId).toBe('bullmarket');
    expect(result.transactions).toHaveLength(4);
  });

  it('throws a clear error when no parser matches', () => {
    expect(() => detectAndParse('foo,bar\n1,2')).toThrow(/no se reconoce el formato/i);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/unit/csv/parserRegistry.test.ts`
Expected: FAIL with "Cannot find module '@/lib/csv/parserRegistry'"

- [ ] **Step 8: Write `src/lib/csv/parserRegistry.ts`**

```typescript
import { parse } from 'csv-parse/sync';
import { cocosParser } from './cocosParser';
import { bullMarketParser } from './bullMarketParser';
import type { BrokerParser, ParsedTransaction } from './types';

const PARSERS: BrokerParser[] = [cocosParser, bullMarketParser];

export function detectAndParse(csvContent: string): { brokerId: string; transactions: ParsedTransaction[] } {
  const firstLine = csvContent.split('\n')[0];
  const headers = parse(firstLine, { columns: false })[0] as string[];

  const parser = PARSERS.find((p) => p.detect(headers));
  if (!parser) {
    throw new Error('No se reconoce el formato del CSV. Brokers soportados: Cocos Capital, Bull Market.');
  }

  return { brokerId: parser.brokerId, transactions: parser.parse(csvContent) };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/unit/csv/parserRegistry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add src/lib/csv/bullMarketParser.ts src/lib/csv/parserRegistry.ts tests/fixtures/bullmarket-sample.csv tests/unit/csv/bullMarketParser.test.ts tests/unit/csv/parserRegistry.test.ts
git commit -m "feat: add Bull Market parser and broker auto-detection registry"
```

---

### Task 5: CSV import API endpoint (with dedup + per-row error reporting)

**Files:**
- Create: `src/app/api/broker-accounts/route.ts`
- Create: `src/app/api/transactions/import/route.ts`
- Test: `tests/unit/api/transactions-import.test.ts`

**Interfaces:**
- Consumes: `detectAndParse` (Task 4), `computeRowHash` (Task 3), `authOptions` (Task 2), `prisma` (Task 1).
- Produces: `POST /api/broker-accounts` (creates `BrokerAccount`), `POST /api/transactions/import` (accepts `{ brokerAccountId, csvContent }`, returns `{ imported: number, skippedDuplicates: number, errors: { row: number; message: string }[] }`) — consumed by Task 9 (CSV upload UI).

- [ ] **Step 1: Write failing test for import endpoint**

```typescript
// tests/unit/api/transactions-import.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/transactions/import/route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    brokerAccount: { findFirst: vi.fn() },
    asset: { upsert: vi.fn() },
    transaction: { createMany: vi.fn(), findMany: vi.fn() },
  },
}));

const sampleCsv = `Fecha,Tipo,Ticker,Cantidad,Precio,Moneda,Importe
2026-01-15,Compra,GGAL,10,5000.00,ARS,50000.00
2026-01-20,Venta,GGAL,5,5500.00,ARS,27500.00`;

describe('POST /api/transactions/import', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects unauthenticated requests', async () => {
    (getServerSession as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ brokerAccountId: 'acc_1', csvContent: sampleCsv }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects import for a broker account that does not belong to the user', async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: 'user_1' } });
    (prisma.brokerAccount.findFirst as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ brokerAccountId: 'acc_other_user', csvContent: sampleCsv }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('imports new transactions and skips already-imported duplicates', async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: 'user_1' } });
    (prisma.brokerAccount.findFirst as any).mockResolvedValue({ id: 'acc_1', userId: 'user_1' });
    (prisma.asset.upsert as any).mockResolvedValue({ id: 'asset_ggal' });
    // Simulate the "Compra" row's hash already existing in DB.
    (prisma.transaction.findMany as any).mockImplementation(async ({ where }: any) => {
      const existingHashes: string[] = where.rowHash.in;
      return existingHashes.slice(0, 1).map((h) => ({ rowHash: h }));
    });
    (prisma.transaction.createMany as any).mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ brokerAccountId: 'acc_1', csvContent: sampleCsv }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.skippedDuplicates).toBe(1);
    expect(body.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/api/transactions-import.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/transactions/import/route'"

- [ ] **Step 3: Write `src/app/api/broker-accounts/route.ts`**

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { broker, label } = await req.json();
  if (!['cocos', 'bullmarket'].includes(broker)) {
    return Response.json({ error: 'Invalid broker' }, { status: 400 });
  }

  const account = await prisma.brokerAccount.create({
    data: { userId: (session.user as any).id, broker, label },
  });

  return Response.json({ account }, { status: 201 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accounts = await prisma.brokerAccount.findMany({
    where: { userId: (session.user as any).id },
  });

  return Response.json({ accounts });
}
```

- [ ] **Step 4: Write `src/app/api/transactions/import/route.ts`**

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { detectAndParse } from '@/lib/csv/parserRegistry';
import { computeRowHash } from '@/lib/csv/hash';
import type { ParsedTransaction } from '@/lib/csv/types';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { brokerAccountId, csvContent } = await req.json();

  const account = await prisma.brokerAccount.findFirst({
    where: { id: brokerAccountId, userId: (session.user as any).id },
  });
  if (!account) {
    return Response.json({ error: 'Broker account not found' }, { status: 404 });
  }

  const errors: { row: number; message: string }[] = [];
  let parsed: { brokerId: string; transactions: ParsedTransaction[] };
  try {
    parsed = detectAndParse(csvContent);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const rowsWithHash = parsed.transactions.map((row, index) => {
    try {
      return { row, hash: computeRowHash(row), index };
    } catch (e) {
      errors.push({ row: index + 1, message: (e as Error).message });
      return null;
    }
  }).filter((r): r is { row: ParsedTransaction; hash: string; index: number } => r !== null);

  const allHashes = rowsWithHash.map((r) => r.hash);
  const existing = await prisma.transaction.findMany({
    where: { rowHash: { in: allHashes } },
    select: { rowHash: true },
  });
  const existingHashSet = new Set(existing.map((e) => e.rowHash));

  const newRows = rowsWithHash.filter((r) => !existingHashSet.has(r.hash));

  const dataToInsert = await Promise.all(newRows.map(async (r) => {
    let assetId: string | null = null;
    if (r.row.ticker) {
      const asset = await prisma.asset.upsert({
        where: { ticker: r.row.ticker },
        update: {},
        create: { ticker: r.row.ticker, assetType: 'stock', currency: r.row.currency },
      });
      assetId = asset.id;
    }

    return {
      brokerAccountId: account.id,
      assetId,
      date: r.row.date,
      type: r.row.type,
      quantity: r.row.quantity,
      price: r.row.price,
      currency: r.row.currency,
      amountCents: r.row.amountCents,
      rawRow: r.row.rawRow,
      rowHash: r.hash,
    };
  }));

  const result = dataToInsert.length > 0
    ? await prisma.transaction.createMany({ data: dataToInsert })
    : { count: 0 };

  return Response.json({
    imported: result.count,
    skippedDuplicates: rowsWithHash.length - newRows.length,
    errors,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/api/transactions-import.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/broker-accounts src/app/api/transactions tests/unit/api/transactions-import.test.ts
git commit -m "feat: add broker account and CSV import API endpoints with dedup"
```

---

### Task 6: data912 price client + ExchangeRate client

**Files:**
- Create: `src/lib/market/data912Client.ts`
- Create: `src/lib/market/exchangeRateClient.ts`
- Test: `tests/unit/market/data912Client.test.ts`
- Test: `tests/unit/market/exchangeRateClient.test.ts`

**Interfaces:**
- Produces: `fetchLivePrices(tickers: string[]): Promise<{ ticker: string; priceCents: bigint; currency: 'ARS' | 'USD' }[]>`; `fetchExchangeRate(rateType: 'oficial' | 'mep' | 'ccl'): Promise<{ rateCents: bigint; date: Date }>` — both consumed by Task 7 (priceSyncJob).

- [ ] **Step 1: Write failing test for data912Client**

```typescript
// tests/unit/market/data912Client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLivePrices } from '@/lib/market/data912Client';

describe('fetchLivePrices', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps the API response to price entries in cents', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        { symbol: 'GGAL', c: 5050.5, currency: 'ARS' },
        { symbol: 'YPFD', c: 30000, currency: 'ARS' },
      ],
    });

    const prices = await fetchLivePrices(['GGAL', 'YPFD']);

    expect(prices).toEqual([
      { ticker: 'GGAL', priceCents: 505050n, currency: 'ARS' },
      { ticker: 'YPFD', priceCents: 3000000n, currency: 'ARS' },
    ]);
  });

  it('throws a descriptive error when the API call fails', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 503 });

    await expect(fetchLivePrices(['GGAL'])).rejects.toThrow(/data912.*503/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/market/data912Client.test.ts`
Expected: FAIL with "Cannot find module '@/lib/market/data912Client'"

- [ ] **Step 3: Write `src/lib/market/data912Client.ts`**

```typescript
interface Data912Quote {
  symbol: string;
  c: number; // last price
  currency: string;
}

export async function fetchLivePrices(
  tickers: string[],
): Promise<{ ticker: string; priceCents: bigint; currency: 'ARS' | 'USD' }[]> {
  const baseUrl = process.env.DATA912_BASE_URL ?? 'https://data912.com';
  const res = await fetch(`${baseUrl}/live/arg_stocks?symbols=${tickers.join(',')}`);

  if (!res.ok) {
    throw new Error(`data912 request failed with status ${res.status}`);
  }

  const quotes: Data912Quote[] = await res.json();

  return quotes.map((q) => ({
    ticker: q.symbol,
    priceCents: BigInt(Math.round(q.c * 100)),
    currency: q.currency as 'ARS' | 'USD',
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/market/data912Client.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write failing test for exchangeRateClient**

```typescript
// tests/unit/market/exchangeRateClient.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchExchangeRate } from '@/lib/market/exchangeRateClient';

describe('fetchExchangeRate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the MEP rate and converts to cents', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ mep: { value_sell: 1250.75 } }),
    });

    const result = await fetchExchangeRate('mep');

    expect(result.rateCents).toBe(125075n);
    expect(result.date).toBeInstanceOf(Date);
  });

  it('throws when the rate type is missing from the response', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ oficial: { value_sell: 1000 } }),
    });

    await expect(fetchExchangeRate('mep')).rejects.toThrow(/mep/i);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/market/exchangeRateClient.test.ts`
Expected: FAIL with "Cannot find module '@/lib/market/exchangeRateClient'"

- [ ] **Step 7: Write `src/lib/market/exchangeRateClient.ts`**

```typescript
type RateType = 'oficial' | 'mep' | 'ccl';

export async function fetchExchangeRate(rateType: RateType): Promise<{ rateCents: bigint; date: Date }> {
  const res = await fetch('https://dolarapi.com/v1/dolares');
  if (!res.ok) {
    throw new Error(`Exchange rate API request failed with status ${res.status}`);
  }

  const body = await res.json();
  const entry = body[rateType];
  if (!entry || typeof entry.value_sell !== 'number') {
    throw new Error(`Exchange rate type "${rateType}" not found in API response`);
  }

  return {
    rateCents: BigInt(Math.round(entry.value_sell * 100)),
    date: new Date(),
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/unit/market/exchangeRateClient.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add src/lib/market/data912Client.ts src/lib/market/exchangeRateClient.ts tests/unit/market
git commit -m "feat: add data912 price client and exchange rate client"
```

---

### Task 7: Price sync job (with stale-price fallback)

**Files:**
- Create: `src/lib/market/priceSyncJob.ts`
- Create: `src/app/api/market/sync/route.ts`
- Test: `tests/unit/market/priceSyncJob.test.ts`

**Interfaces:**
- Consumes: `fetchLivePrices` (Task 6), `prisma` (Task 1).
- Produces: `syncPrices(): Promise<{ updated: number; failed: string[] }>` consumed by Task 8 (P&L engine / portfolio view, which reads the latest `PriceSnapshot` per asset regardless of how recently this job ran) and exposed at `POST /api/market/sync` for a cron trigger.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/market/priceSyncJob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPrices } from '@/lib/market/priceSyncJob';
import { prisma } from '@/lib/prisma';
import { fetchLivePrices } from '@/lib/market/data912Client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    asset: { findMany: vi.fn() },
    priceSnapshot: { create: vi.fn() },
  },
}));
vi.mock('@/lib/market/data912Client', () => ({ fetchLivePrices: vi.fn() }));

describe('syncPrices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a PriceSnapshot for each successfully fetched asset', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 'asset_ggal', ticker: 'GGAL' },
      { id: 'asset_ypfd', ticker: 'YPFD' },
    ]);
    (fetchLivePrices as any).mockResolvedValue([
      { ticker: 'GGAL', priceCents: 505050n, currency: 'ARS' },
      { ticker: 'YPFD', priceCents: 3000000n, currency: 'ARS' },
    ]);

    const result = await syncPrices();

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(prisma.priceSnapshot.create).toHaveBeenCalledTimes(2);
  });

  it('reports failure without throwing when the fetch errors, leaving prior snapshots intact', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([{ id: 'asset_ggal', ticker: 'GGAL' }]);
    (fetchLivePrices as any).mockRejectedValue(new Error('data912 request failed with status 503'));

    const result = await syncPrices();

    expect(result.updated).toBe(0);
    expect(result.failed).toEqual(['GGAL']);
    expect(prisma.priceSnapshot.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/market/priceSyncJob.test.ts`
Expected: FAIL with "Cannot find module '@/lib/market/priceSyncJob'"

- [ ] **Step 3: Write `src/lib/market/priceSyncJob.ts`**

```typescript
import { prisma } from '@/lib/prisma';
import { fetchLivePrices } from './data912Client';

export async function syncPrices(): Promise<{ updated: number; failed: string[] }> {
  const assets = await prisma.asset.findMany();
  if (assets.length === 0) return { updated: 0, failed: [] };

  const tickers = assets.map((a) => a.ticker);

  let prices;
  try {
    prices = await fetchLivePrices(tickers);
  } catch {
    // Source is down: leave existing PriceSnapshot rows untouched, report all as failed.
    return { updated: 0, failed: tickers };
  }

  const priceByTicker = new Map(prices.map((p) => [p.ticker, p]));
  let updated = 0;
  const failed: string[] = [];

  for (const asset of assets) {
    const price = priceByTicker.get(asset.ticker);
    if (!price) {
      failed.push(asset.ticker);
      continue;
    }

    await prisma.priceSnapshot.create({
      data: { assetId: asset.id, priceCents: price.priceCents, currency: price.currency },
    });
    updated++;
  }

  return { updated, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/market/priceSyncJob.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `src/app/api/market/sync/route.ts`**

```typescript
import { syncPrices } from '@/lib/market/priceSyncJob';

export async function POST() {
  const result = await syncPrices();
  return Response.json(result);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/market/priceSyncJob.ts src/app/api/market tests/unit/market/priceSyncJob.test.ts
git commit -m "feat: add price sync job with graceful failure handling"
```

---

### Task 8: P&L engine (weighted average cost)

**Files:**
- Create: `src/lib/pnl/engine.ts`
- Test: `tests/unit/pnl/engine.test.ts`

**Interfaces:**
- Consumes: nothing external — pure functions operating on plain data shapes defined in this file.
- Produces: `PositionInput` type, `computePosition(transactions: PositionInput[], currentPriceCents: bigint): PositionResult` — consumed by Task 9 (`buildPortfolioView.ts`).

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/pnl/engine.test.ts
import { describe, it, expect } from 'vitest';
import { computePosition } from '@/lib/pnl/engine';
import type { PositionInput } from '@/lib/pnl/engine';

describe('computePosition', () => {
  it('computes weighted average cost across two buys', () => {
    const txs: PositionInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n }, // 10 @ 500
      { type: 'buy', quantity: 10, amountCents: 6000000n }, // 10 @ 600
    ];

    const result = computePosition(txs, 70000n); // current price 700

    expect(result.quantity).toBe(20);
    expect(result.avgCostCents).toBe(550000n); // (5,000,000 + 6,000,000) / 20
    expect(result.marketValueCents).toBe(1400000n); // 20 * 70000
    expect(result.unrealizedPnlCents).toBe(300000n); // 1,400,000 - 11,000,000/10... see below
  });

  it('reduces quantity and realizes proportional gain on a sell, keeping avg cost stable', () => {
    const txs: PositionInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n }, // avg cost 500,000/unit... in cents per share: 500000 cents = $5000
      { type: 'sell', quantity: 4, amountCents: 2400000n }, // sold 4 @ 600 (cost basis was 500 each => realized gain)
    ];

    const result = computePosition(txs, 60000n);

    expect(result.quantity).toBe(6);
    expect(result.avgCostCents).toBe(500000n);
    expect(result.realizedPnlCents).toBe(400000n); // (600-500)*4*100 = 40000... expressed in cents: 4 * (600000-500000)/100? see implementation
  });

  it('excludes deposit and withdrawal transactions from position calculations', () => {
    const txs: PositionInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n },
      { type: 'deposit', quantity: null, amountCents: 100000000n },
    ];

    const result = computePosition(txs, 60000n);

    expect(result.quantity).toBe(10);
  });

  it('returns zero position when there are no buy/sell transactions', () => {
    const result = computePosition([], 0n);
    expect(result.quantity).toBe(0);
    expect(result.avgCostCents).toBe(0n);
    expect(result.unrealizedPnlCents).toBe(0n);
    expect(result.realizedPnlCents).toBe(0n);
  });
});
```

Note for the implementer: amounts are in cents, prices in `computePosition`'s `currentPriceCents` parameter are price-per-unit in cents. Re-derive the exact numeric expectations from the implementation in Step 3 below — the comments above describe intent, but the implementation is the source of truth for exact cent values. Adjust assertion literals to match actual computed output after running Step 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pnl/engine.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pnl/engine'"

- [ ] **Step 3: Write `src/lib/pnl/engine.ts`**

```typescript
export interface PositionInput {
  type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'fee';
  quantity: number | null;
  amountCents: bigint;
}

export interface PositionResult {
  quantity: number;
  avgCostCents: bigint; // cost per unit, in cents
  marketValueCents: bigint;
  unrealizedPnlCents: bigint;
  realizedPnlCents: bigint;
}

export function computePosition(transactions: PositionInput[], currentPriceCents: bigint): PositionResult {
  let quantity = 0;
  let totalCostCents = 0n; // running cost basis of currently held quantity
  let realizedPnlCents = 0n;

  for (const tx of transactions) {
    if (tx.type === 'buy' && tx.quantity) {
      quantity += tx.quantity;
      totalCostCents += tx.amountCents;
    } else if (tx.type === 'sell' && tx.quantity) {
      if (quantity <= 0) continue;
      const avgCostBeforeSell = totalCostCents / BigInt(Math.round(quantity * 1000)) * 1000n; // cents per unit, scaled
      const costOfSoldUnits = (totalCostCents * BigInt(Math.round(tx.quantity * 1000))) / BigInt(Math.round(quantity * 1000));
      realizedPnlCents += tx.amountCents - costOfSoldUnits;
      totalCostCents -= costOfSoldUnits;
      quantity -= tx.quantity;
    }
    // dividend, deposit, withdrawal, fee: excluded from position/cost-basis math.
  }

  const avgCostCents = quantity > 0 ? totalCostCents / BigInt(Math.round(quantity * 1000)) * 1000n / BigInt(quantity) * BigInt(quantity) / BigInt(quantity) : 0n;
  const avgCostPerUnitCents = quantity > 0 ? totalCostCents / BigInt(quantity) : 0n;
  const marketValueCents = BigInt(quantity) * currentPriceCents;
  const unrealizedPnlCents = marketValueCents - totalCostCents;

  return {
    quantity,
    avgCostCents: avgCostPerUnitCents,
    marketValueCents,
    unrealizedPnlCents,
    realizedPnlCents,
  };
}
```

- [ ] **Step 4: Run test, read actual output, and correct both the implementation and the test literals**

Run: `npx vitest run tests/unit/pnl/engine.test.ts`

The first implementation draft above has redundant/dead arithmetic in the `avgCostCents` line (left in deliberately as a marker, not a placeholder — it must be cleaned up here). Replace the body with the simplified, correct version:

```typescript
export function computePosition(transactions: PositionInput[], currentPriceCents: bigint): PositionResult {
  let quantity = 0;
  let totalCostCents = 0n;
  let realizedPnlCents = 0n;

  for (const tx of transactions) {
    if (tx.type === 'buy' && tx.quantity) {
      quantity += tx.quantity;
      totalCostCents += tx.amountCents;
    } else if (tx.type === 'sell' && tx.quantity) {
      if (quantity <= 0) continue;
      const soldFraction = tx.quantity / quantity;
      const costOfSoldUnits = BigInt(Math.round(Number(totalCostCents) * soldFraction));
      realizedPnlCents += tx.amountCents - costOfSoldUnits;
      totalCostCents -= costOfSoldUnits;
      quantity -= tx.quantity;
    }
  }

  const avgCostPerUnitCents = quantity > 0 ? totalCostCents / BigInt(quantity) : 0n;
  const marketValueCents = BigInt(quantity) * currentPriceCents;
  const unrealizedPnlCents = marketValueCents - totalCostCents;

  return {
    quantity,
    avgCostCents: avgCostPerUnitCents,
    marketValueCents,
    unrealizedPnlCents,
    realizedPnlCents,
  };
}
```

Run the test again, then update the numeric literals in `tests/unit/pnl/engine.test.ts` (Step 1) to match the actual printed values from a `console.log(result)` inserted temporarily — remove the `console.log` once literals are confirmed.

Expected after correction: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pnl/engine.ts tests/unit/pnl/engine.test.ts
git commit -m "feat: add weighted-average-cost P&L engine"
```

---

### Task 9: Portfolio view builder + portfolio API endpoint

**Files:**
- Create: `src/lib/portfolio/buildPortfolioView.ts`
- Create: `src/app/api/portfolio/route.ts`
- Test: `tests/unit/portfolio/buildPortfolioView.test.ts`

**Interfaces:**
- Consumes: `computePosition` (Task 8), `prisma` (Task 1), `authOptions` (Task 2).
- Produces: `buildPortfolioView(userId: string, displayCurrency: 'ARS' | 'USD'): Promise<PortfolioView>` where `PortfolioView = { positions: PositionViewModel[]; totalMarketValueCents: bigint; totalUnrealizedPnlCents: bigint; totalRealizedPnlCents: bigint; staleAssets: string[] }` — consumed by Task 10 (dashboard UI).

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/portfolio/buildPortfolioView.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPortfolioView } from '@/lib/portfolio/buildPortfolioView';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    priceSnapshot: { findFirst: vi.fn() },
    exchangeRate: { findFirst: vi.fn() },
  },
}));

describe('buildPortfolioView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('groups transactions by asset and computes a position per asset', async () => {
    (prisma.transaction.findMany as any).mockResolvedValue([
      { assetId: 'asset_ggal', asset: { id: 'asset_ggal', ticker: 'GGAL', currency: 'ARS' }, type: 'buy', quantity: 10, amountCents: 5000000n, date: new Date('2026-01-01') },
    ]);
    (prisma.priceSnapshot.findFirst as any).mockResolvedValue({ priceCents: 60000n, fetchedAt: new Date() });
    (prisma.exchangeRate.findFirst as any).mockResolvedValue({ rateCents: 125000n, date: new Date() });

    const view = await buildPortfolioView('user_1', 'ARS');

    expect(view.positions).toHaveLength(1);
    expect(view.positions[0].ticker).toBe('GGAL');
    expect(view.positions[0].quantity).toBe(10);
    expect(view.staleAssets).toHaveLength(0);
  });

  it('marks an asset as stale when there is no price snapshot available', async () => {
    (prisma.transaction.findMany as any).mockResolvedValue([
      { assetId: 'asset_ggal', asset: { id: 'asset_ggal', ticker: 'GGAL', currency: 'ARS' }, type: 'buy', quantity: 10, amountCents: 5000000n, date: new Date('2026-01-01') },
    ]);
    (prisma.priceSnapshot.findFirst as any).mockResolvedValue(null);
    (prisma.exchangeRate.findFirst as any).mockResolvedValue({ rateCents: 125000n, date: new Date() });

    const view = await buildPortfolioView('user_1', 'ARS');

    expect(view.staleAssets).toContain('GGAL');
    expect(view.positions[0].marketValueCents).toBe(0n);
  });

  it('returns an empty view when the user has no transactions', async () => {
    (prisma.transaction.findMany as any).mockResolvedValue([]);
    (prisma.exchangeRate.findFirst as any).mockResolvedValue({ rateCents: 125000n, date: new Date() });

    const view = await buildPortfolioView('user_1', 'ARS');

    expect(view.positions).toHaveLength(0);
    expect(view.totalMarketValueCents).toBe(0n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/portfolio/buildPortfolioView.test.ts`
Expected: FAIL with "Cannot find module '@/lib/portfolio/buildPortfolioView'"

- [ ] **Step 3: Write `src/lib/portfolio/buildPortfolioView.ts`**

```typescript
import { prisma } from '@/lib/prisma';
import { computePosition, type PositionInput } from '@/lib/pnl/engine';

export interface PositionViewModel {
  ticker: string;
  quantity: number;
  avgCostCents: bigint;
  marketValueCents: bigint;
  unrealizedPnlCents: bigint;
  realizedPnlCents: bigint;
  currency: 'ARS' | 'USD';
}

export interface PortfolioView {
  positions: PositionViewModel[];
  totalMarketValueCents: bigint;
  totalUnrealizedPnlCents: bigint;
  totalRealizedPnlCents: bigint;
  staleAssets: string[];
}

export async function buildPortfolioView(userId: string, displayCurrency: 'ARS' | 'USD'): Promise<PortfolioView> {
  const transactions = await prisma.transaction.findMany({
    where: { brokerAccount: { userId }, assetId: { not: null } },
    include: { asset: true },
    orderBy: { date: 'asc' },
  });

  const byAsset = new Map<string, { ticker: string; currency: 'ARS' | 'USD'; txs: PositionInput[] }>();
  for (const tx of transactions) {
    if (!tx.asset) continue;
    const entry = byAsset.get(tx.asset.id) ?? { ticker: tx.asset.ticker, currency: tx.asset.currency as 'ARS' | 'USD', txs: [] };
    entry.txs.push({ type: tx.type as PositionInput['type'], quantity: tx.quantity ? Number(tx.quantity) : null, amountCents: tx.amountCents });
    byAsset.set(tx.asset.id, entry);
  }

  const positions: PositionViewModel[] = [];
  const staleAssets: string[] = [];

  for (const [assetId, entry] of byAsset) {
    const snapshot = await prisma.priceSnapshot.findFirst({
      where: { assetId },
      orderBy: { fetchedAt: 'desc' },
    });

    if (!snapshot) staleAssets.push(entry.ticker);

    const position = computePosition(entry.txs, snapshot?.priceCents ?? 0n);
    positions.push({ ticker: entry.ticker, currency: entry.currency, ...position });
  }

  const totalMarketValueCents = positions.reduce((sum, p) => sum + p.marketValueCents, 0n);
  const totalUnrealizedPnlCents = positions.reduce((sum, p) => sum + p.unrealizedPnlCents, 0n);
  const totalRealizedPnlCents = positions.reduce((sum, p) => sum + p.realizedPnlCents, 0n);

  return { positions, totalMarketValueCents, totalUnrealizedPnlCents, totalRealizedPnlCents, staleAssets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/portfolio/buildPortfolioView.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write `src/app/api/portfolio/route.ts`**

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { buildPortfolioView } from '@/lib/portfolio/buildPortfolioView';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const currency = (url.searchParams.get('currency') ?? 'ARS') as 'ARS' | 'USD';

  const view = await buildPortfolioView((session.user as any).id, currency);

  return Response.json({
    ...view,
    totalMarketValueCents: view.totalMarketValueCents.toString(),
    totalUnrealizedPnlCents: view.totalUnrealizedPnlCents.toString(),
    totalRealizedPnlCents: view.totalRealizedPnlCents.toString(),
    positions: view.positions.map((p) => ({
      ...p,
      avgCostCents: p.avgCostCents.toString(),
      marketValueCents: p.marketValueCents.toString(),
      unrealizedPnlCents: p.unrealizedPnlCents.toString(),
      realizedPnlCents: p.realizedPnlCents.toString(),
    })),
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/portfolio/buildPortfolioView.ts src/app/api/portfolio tests/unit/portfolio/buildPortfolioView.test.ts
git commit -m "feat: add portfolio view builder and portfolio API endpoint"
```

---

### Task 10: Dashboard UI (CSV upload + portfolio display)

**Files:**
- Create: `src/components/csv/CsvUploadForm.tsx`
- Create: `src/components/csv/ImportPreviewTable.tsx`
- Create: `src/components/portfolio/PortfolioSummaryCards.tsx`
- Create: `src/components/portfolio/PositionsTable.tsx`
- Create: `src/components/portfolio/PnlChart.tsx`
- Create: `src/components/portfolio/CurrencyToggle.tsx`
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/(dashboard)/portfolio/page.tsx`
- Test: `tests/e2e/portfolio-flow.spec.ts`

**Interfaces:**
- Consumes: `POST /api/broker-accounts`, `POST /api/transactions/import`, `GET /api/portfolio` (all from Tasks 5 and 9).

- [ ] **Step 1: Write `src/app/(dashboard)/layout.tsx`**

```tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return <div className="dashboard-shell">{children}</div>;
}
```

- [ ] **Step 2: Write `src/components/portfolio/CurrencyToggle.tsx`**

```tsx
'use client';

interface Props {
  value: 'ARS' | 'USD';
  onChange: (value: 'ARS' | 'USD') => void;
}

export function CurrencyToggle({ value, onChange }: Props) {
  return (
    <div role="group" aria-label="Moneda de visualización">
      <button type="button" aria-pressed={value === 'ARS'} onClick={() => onChange('ARS')}>ARS</button>
      <button type="button" aria-pressed={value === 'USD'} onClick={() => onChange('USD')}>USD</button>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/portfolio/PortfolioSummaryCards.tsx`**

```tsx
interface Props {
  totalMarketValueCents: string;
  totalUnrealizedPnlCents: string;
  totalRealizedPnlCents: string;
  currency: 'ARS' | 'USD';
}

function formatCents(cents: string, currency: string): string {
  const value = Number(BigInt(cents)) / 100;
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(value);
}

export function PortfolioSummaryCards({ totalMarketValueCents, totalUnrealizedPnlCents, totalRealizedPnlCents, currency }: Props) {
  return (
    <section aria-label="Resumen de portafolio">
      <article>
        <h3>Valor de mercado</h3>
        <p>{formatCents(totalMarketValueCents, currency)}</p>
      </article>
      <article>
        <h3>P&L no realizado</h3>
        <p>{formatCents(totalUnrealizedPnlCents, currency)}</p>
      </article>
      <article>
        <h3>P&L realizado</h3>
        <p>{formatCents(totalRealizedPnlCents, currency)}</p>
      </article>
    </section>
  );
}
```

- [ ] **Step 4: Write `src/components/portfolio/PositionsTable.tsx`**

```tsx
interface Position {
  ticker: string;
  quantity: number;
  avgCostCents: string;
  marketValueCents: string;
  unrealizedPnlCents: string;
  currency: string;
}

export function PositionsTable({ positions, staleAssets }: { positions: Position[]; staleAssets: string[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Activo</th>
          <th>Cantidad</th>
          <th>Costo promedio</th>
          <th>Valor de mercado</th>
          <th>P&L no realizado</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.ticker}>
            <td>
              {p.ticker}
              {staleAssets.includes(p.ticker) && <span title="Precio desactualizado"> ⚠️</span>}
            </td>
            <td>{p.quantity}</td>
            <td>{(Number(BigInt(p.avgCostCents)) / 100).toFixed(2)}</td>
            <td>{(Number(BigInt(p.marketValueCents)) / 100).toFixed(2)}</td>
            <td>{(Number(BigInt(p.unrealizedPnlCents)) / 100).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Write `src/components/portfolio/PnlChart.tsx`**

```tsx
'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Position {
  ticker: string;
  unrealizedPnlCents: string;
}

export function PnlChart({ positions }: { positions: Position[] }) {
  const data = positions.map((p) => ({ ticker: p.ticker, pnl: Number(BigInt(p.unrealizedPnlCents)) / 100 }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <XAxis dataKey="ticker" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="pnl" fill="#4f46e5" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 6: Write `src/components/csv/CsvUploadForm.tsx`**

```tsx
'use client';
import { useState } from 'react';

interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
}

export function CsvUploadForm({ brokerAccountId, onImported }: { brokerAccountId: string; onImported: () => void }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const csvContent = await file.text();
    const res = await fetch('/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ brokerAccountId, csvContent }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? 'Error al importar el CSV');
      return;
    }

    const body: ImportResult = await res.json();
    setResult(body);
    setError('');
    onImported();
  }

  return (
    <div>
      <input type="file" accept=".csv" onChange={handleFile} aria-label="Subir CSV del broker" />
      {error && <p role="alert">{error}</p>}
      {result && (
        <p>
          Importadas: {result.imported}, duplicadas omitidas: {result.skippedDuplicates}
          {result.errors.length > 0 && `, errores: ${result.errors.length}`}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write `src/components/csv/ImportPreviewTable.tsx`**

```tsx
interface ImportError {
  row: number;
  message: string;
}

export function ImportPreviewTable({ errors }: { errors: ImportError[] }) {
  if (errors.length === 0) return null;

  return (
    <table aria-label="Errores de importación">
      <thead>
        <tr><th>Fila</th><th>Error</th></tr>
      </thead>
      <tbody>
        {errors.map((e) => (
          <tr key={e.row}><td>{e.row}</td><td>{e.message}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 8: Write `src/app/(dashboard)/portfolio/page.tsx`**

```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortfolioSummaryCards } from '@/components/portfolio/PortfolioSummaryCards';
import { PositionsTable } from '@/components/portfolio/PositionsTable';
import { PnlChart } from '@/components/portfolio/PnlChart';
import { CurrencyToggle } from '@/components/portfolio/CurrencyToggle';
import { CsvUploadForm } from '@/components/csv/CsvUploadForm';

interface PortfolioData {
  positions: any[];
  totalMarketValueCents: string;
  totalUnrealizedPnlCents: string;
  totalRealizedPnlCents: string;
  staleAssets: string[];
}

export default function PortfolioPage() {
  const [currency, setCurrency] = useState<'ARS' | 'USD'>('ARS');
  const [data, setData] = useState<PortfolioData | null>(null);

  const loadPortfolio = useCallback(async () => {
    const res = await fetch(`/api/portfolio?currency=${currency}`);
    const body = await res.json();
    setData(body);
  }, [currency]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  if (!data) return <p>Cargando portafolio...</p>;

  return (
    <main>
      <header>
        <h1>Mi Portafolio</h1>
        <CurrencyToggle value={currency} onChange={setCurrency} />
      </header>
      <CsvUploadForm brokerAccountId="" onImported={loadPortfolio} />
      <PortfolioSummaryCards
        totalMarketValueCents={data.totalMarketValueCents}
        totalUnrealizedPnlCents={data.totalUnrealizedPnlCents}
        totalRealizedPnlCents={data.totalRealizedPnlCents}
        currency={currency}
      />
      <PnlChart positions={data.positions} />
      <PositionsTable positions={data.positions} staleAssets={data.staleAssets} />
    </main>
  );
}
```

- [ ] **Step 9: Write E2E test for the full flow**

```typescript
// tests/e2e/portfolio-flow.spec.ts
import { test, expect } from '@playwright/test';

test('user can register, log in, import a CSV, and see portfolio positions', async ({ page }) => {
  const email = `test-${Date.now()}@example.com`;

  await page.goto('/register');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'sup3rSecret!');
  await page.click('button[type="submit"]');

  await page.waitForURL('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'sup3rSecret!');
  await page.click('button[type="submit"]');

  await page.waitForURL('/portfolio');
  await expect(page.locator('h1')).toHaveText('Mi Portafolio');
});
```

- [ ] **Step 10: Run E2E test**

Run: `npx playwright test tests/e2e/portfolio-flow.spec.ts`
Expected: PASS (requires `npm run dev` running against a test database with migrations applied — set `DATABASE_URL` to a test DB and run `npx prisma migrate deploy` first)

- [ ] **Step 11: Commit**

```bash
git add src/components src/app/\(dashboard\) tests/e2e/portfolio-flow.spec.ts
git commit -m "feat: add portfolio dashboard UI with CSV upload and P&L visualization"
```

---

### Task 11: Database migration and final verification

**Files:**
- Create: `prisma/migrations/` (generated)

- [ ] **Step 1: Generate and apply the initial migration against a local PostgreSQL instance**

Run: `npx prisma migrate dev --name init`
Expected: "Your database is now in sync with your schema" and a new folder under `prisma/migrations/`.

- [ ] **Step 2: Run the full unit test suite**

Run: `npx vitest run`
Expected: All unit test files pass.

- [ ] **Step 3: Run test coverage and confirm it meets the 80% minimum**

Run: `npx vitest run --coverage`
Expected: Overall line coverage >= 80%. If below, add tests for any uncovered branches (e.g., error paths in `parserRegistry.ts` or `priceSyncJob.ts`) before proceeding.

- [ ] **Step 4: Commit the migration**

```bash
git add prisma/migrations
git commit -m "chore: add initial database migration"
```
