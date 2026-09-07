import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { parseCopaBymaWorkbook } from '../static-app/src/copaByma';

// Build an in-memory workbook mirroring the real "Copa BYMA" file: a first
// sheet with other content, then "Base Operaciones" with the orders, then a
// "Compras Pendientes" block that must be ignored.
async function buildWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Cartera en Vivo').addRow(['Instrumento', 'Ticker', 'Moneda']);
  const ws = wb.addWorksheet('Base Operaciones');
  ws.addRow(['Operación', 'Activo', 'Monto', 'Nominales', 'Precio', 'TC IMPLICITO']);
  ws.addRow(['Compra', 'AL30D', 19500000, 22820, 85450, null]);
  ws.addRow(['Venta', 'AL30D', null, 22820, 0.5586, 1529.74]);
  ws.addRow(['Compra', 'CAC50O', 82660, 1, 82660, null]);
  ws.addRow(['Venta', 'CAC50O', null, 1, 81020, null]);
  ws.addRow(['Compra', 'PEP', null, 338, 12400, 1594]);
  ws.addRow(['Compra', 'UBER', null, 55, 60025, 1580]);
  ws.addRow(['Compra', 'VST', null, 339, 8825, 1578]);
  ws.addRow(['Compra', 'TTC8D', null, 3860, 1.035, null]);
  ws.addRow(['Compra', 'MGCTD', null, 2000, 1.026, null]);
  ws.addRow(['Compra', 'CAC5D', null, 5507, 0.535, null]);
  ws.addRow([]);
  ws.addRow(['Compras Pendientes']);
  ws.addRow(['Operación', 'Activo', 'Monto', 'Nominales', 'Precio', 'TC IMPLICITO']);
  ws.addRow(['Compra', 'MGCTD', null, 1822.83, 1.026, null]); // must NOT be imported
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe('parseCopaBymaWorkbook', () => {
  let res: NonNullable<Awaited<ReturnType<typeof parseCopaBymaWorkbook>>>;
  beforeAll(async () => {
    res = (await parseCopaBymaWorkbook(await buildWorkbook()))!;
  });

  it('imports exactly the 10 confirmed orders and skips pending', () => {
    expect(res).not.toBeNull();
    expect(res.errors).toHaveLength(0);
    expect(res.transactions).toHaveLength(10);
    // The pending MGCTD (fractional nominales) is excluded.
    expect(res.transactions.some((t) => t.quantity === 1822.83)).toBe(false);
  });

  it('uses Monto when present, else nominales × precio', () => {
    const byIdx = res.transactions;
    expect(byIdx[0].amountCents).toBe(1950000000n); // AL30D buy from Monto 19.5M
    const pep = res.transactions.find((t) => t.ticker === 'PEP')!;
    expect(pep.amountCents).toBe(BigInt(Math.round(338 * 12400 * 100))); // 4.191.200
  });

  it('infers USD for small unit prices, ARS otherwise (splits AL30D legs)', () => {
    const [al30buy, al30sell] = res.transactions.filter((t) => t.ticker === 'AL30D');
    expect(al30buy.currency).toBe('ARS'); // price 85.450
    expect(al30sell.currency).toBe('USD'); // price 0,5586
    expect(res.transactions.find((t) => t.ticker === 'PEP')!.currency).toBe('ARS');
    expect(res.transactions.find((t) => t.ticker === 'TTC8D')!.currency).toBe('USD');
  });

  it('tags bonds/ONs (incl. USD MGCTD) so they are valued at cost', () => {
    expect(res.transactions.find((t) => t.ticker === 'MGCTD')!.rawRow.instrumento).toBe('ON MGCTD');
    expect(res.transactions.find((t) => t.ticker === 'AL30D')!.rawRow.instrumento).toBe('ON AL30D');
    // Equities stay plain (no ON prefix → not valued at cost).
    expect(res.transactions.find((t) => t.ticker === 'PEP')!.rawRow.instrumento).toBe('PEP');
  });

  it('keeps buy before sell (row order) for the round-trips', () => {
    const al = res.transactions.filter((t) => t.ticker === 'AL30D');
    expect(al[0].type).toBe('buy');
    expect(al[1].type).toBe('sell');
  });
});
