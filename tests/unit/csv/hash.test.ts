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
