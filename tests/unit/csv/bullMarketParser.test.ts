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
    const { transactions } = bullMarketParser.parse(sampleCsv);
    expect(transactions[0].type).toBe('buy');
    expect(transactions[0].ticker).toBe('GGAL');
    expect(transactions[0].amountCents).toBe(5000000n);
  });

  it('maps DEPOSIT to deposit type with null ticker', () => {
    const { transactions } = bullMarketParser.parse(sampleCsv);
    expect(transactions[2].type).toBe('deposit');
    expect(transactions[2].ticker).toBeNull();
  });

  it('collects a row-tagged error for an unknown operation without dropping other rows', () => {
    const csvWithBadRow = `Date,Operation,Symbol,Qty,Price,Currency,Total
2026-01-15,BUY,GGAL,10,5000.00,ARS,50000.00
2026-01-20,WEIRD_OP,GGAL,5,5500.00,ARS,27500.00`;

    const { transactions, errors } = bullMarketParser.parse(csvWithBadRow);
    expect(transactions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ row: 2, message: 'Bull Market parser: unknown operation "WEIRD_OP"' });
  });
});
