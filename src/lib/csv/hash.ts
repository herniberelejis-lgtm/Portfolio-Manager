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
