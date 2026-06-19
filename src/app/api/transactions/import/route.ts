import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { detectAndParse } from '@/lib/csv/parserRegistry';
import { parsePpiWorkbook } from '@/lib/csv/ppiParser';
import { computeRowHash } from '@/lib/csv/hash';
import type { ParsedTransaction, RowError } from '@/lib/csv/types';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { brokerAccountId, csvContent, xlsxBase64 } = await req.json();
  if (typeof brokerAccountId !== 'string' || (typeof csvContent !== 'string' && typeof xlsxBase64 !== 'string')) {
    return Response.json(
      { error: 'brokerAccountId and either csvContent or xlsxBase64 are required' },
      { status: 400 }
    );
  }

  const account = await prisma.brokerAccount.findFirst({
    where: { id: brokerAccountId, userId: (session.user as any).id },
  });
  if (!account) {
    return Response.json({ error: 'Broker account not found' }, { status: 404 });
  }

  let parsed: { brokerId: string; transactions: ParsedTransaction[]; errors: RowError[] };
  try {
    if (typeof xlsxBase64 === 'string') {
      const buffer = Buffer.from(xlsxBase64, 'base64');
      const { transactions, errors } = await parsePpiWorkbook(buffer);
      parsed = {
        brokerId: 'ppi',
        transactions,
        errors: errors.map((e) => ({ row: e.row, message: `[${e.sheet}] ${e.message}` })),
      };
    } else {
      parsed = detectAndParse(csvContent);
    }
  } catch (e) {
    // Only thrown when no parser recognizes the file's headers/shape at all — a
    // whole-file failure, not a per-row one, so a single error is correct here.
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const errors: RowError[] = [...parsed.errors];

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
      rawRow: JSON.stringify(r.row.rawRow),
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
