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

  it('rejects a request missing csvContent with a 400 instead of throwing', async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: 'user_1' } });

    const req = new Request('http://localhost/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ brokerAccountId: 'acc_1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('imports valid rows and reports a malformed row as a row-tagged error instead of aborting the file', async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: 'user_1' } });
    (prisma.brokerAccount.findFirst as any).mockResolvedValue({ id: 'acc_1', userId: 'user_1' });
    (prisma.asset.upsert as any).mockResolvedValue({ id: 'asset_ggal' });
    (prisma.transaction.findMany as any).mockResolvedValue([]);
    (prisma.transaction.createMany as any).mockResolvedValue({ count: 1 });

    const csvWithBadRow = `Fecha,Tipo,Ticker,Cantidad,Precio,Moneda,Importe
2026-01-15,Compra,GGAL,10,5000.00,ARS,50000.00
2026-01-20,Transferencia Rara,GGAL,5,5500.00,ARS,27500.00`;

    const req = new Request('http://localhost/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ brokerAccountId: 'acc_1', csvContent: csvWithBadRow }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toMatch(/unknown transaction type/);
  });
});
