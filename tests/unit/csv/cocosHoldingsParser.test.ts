import { describe, it, expect } from 'vitest';
import { cocosHoldingsParser } from '@/lib/csv/cocosHoldingsParser';

const HEADER = 'instrumento;cantidad;precio;moneda;total';

describe('cocosHoldingsParser', () => {
  it('detects the tenencias header and rejects movements headers', () => {
    expect(cocosHoldingsParser.detect(HEADER.split(';'))).toBe(true);
    expect(
      cocosHoldingsParser.detect(['nroTicket', 'fechaEjecucion', 'tipoOperacion', 'instrumento']),
    ).toBe(false);
  });

  it('imports positions as synthetic buys, supports fractional FCI units, skips cash rows', () => {
    const csv = [
      HEADER,
      'CELULOSA ARGENTINA S.A. - ORD. 1V. (CELU);1293;290;ARS;374970',
      'CEDEAR APPLE INC. (AAPL);1;23010;ARS;23010',
      'FCI COCOS RENDIMIENTO CL. A $ ESC (COCORMA);3799,54;11210,96;ARS;42596,5',
      'ARS;710678,51;1;ARS;710678,51', // cash row -> skipped (no ticker)
    ].join('\n');

    const { transactions, errors } = cocosHoldingsParser.parse(csv);

    expect(errors).toEqual([]);
    expect(transactions.map((t) => t.ticker)).toEqual(['CELU', 'AAPL', 'COCORMA']);
    expect(transactions.every((t) => t.type === 'buy')).toBe(true);
    const fci = transactions.find((t) => t.ticker === 'COCORMA')!;
    expect(fci.quantity).toBeCloseTo(3799.54, 2);
    expect(fci.amountCents).toBe(4259650n);
  });
});
