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
    const { transactions } = cocosParser.parse(sampleCsv);
    const buy = transactions[0];
    expect(buy.type).toBe('buy');
    expect(buy.ticker).toBe('GGAL');
    expect(buy.quantity).toBe(10);
    expect(buy.price).toBe(5000);
    expect(buy.currency).toBe('ARS');
    expect(buy.amountCents).toBe(5000000n);
  });

  it('parses a sell row correctly', () => {
    const { transactions } = cocosParser.parse(sampleCsv);
    const sell = transactions[1];
    expect(sell.type).toBe('sell');
    expect(sell.quantity).toBe(5);
  });

  it('maps "Ingreso de fondos" to deposit with null ticker', () => {
    const { transactions } = cocosParser.parse(sampleCsv);
    const deposit = transactions[2];
    expect(deposit.type).toBe('deposit');
    expect(deposit.ticker).toBeNull();
    expect(deposit.amountCents).toBe(10000000n);
  });

  it('maps "Dividendo" to dividend type', () => {
    const { transactions } = cocosParser.parse(sampleCsv);
    const dividend = transactions[3];
    expect(dividend.type).toBe('dividend');
  });

  it('collects a row-tagged error for an unknown transaction type without dropping other rows', () => {
    const csvWithBadRow = `Fecha,Tipo,Ticker,Cantidad,Precio,Moneda,Importe
2026-01-15,Compra,GGAL,10,5000.00,ARS,50000.00
2026-01-20,Transferencia Rara,GGAL,5,5500.00,ARS,27500.00`;

    const { transactions, errors } = cocosParser.parse(csvWithBadRow);
    expect(transactions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ row: 2, message: 'Cocos parser: unknown transaction type "Transferencia Rara"' });
  });
});
