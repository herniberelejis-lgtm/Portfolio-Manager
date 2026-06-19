import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { detectPpiWorkbook, parsePpiWorkbook } from '@/lib/csv/ppiParser';

let sampleBuffer: Buffer;

beforeAll(async () => {
  const workbook = new ExcelJS.Workbook();

  const pesos = workbook.addWorksheet('Pesos');
  pesos.addRow(['Fecha', 'Descripción', 'Cantidad', 'Precio', 'Importe', 'Saldo', 'Moneda']);
  pesos.addRow(['08/06/2026', 'Retiro de Fondos ', 0, 0, -8500.62, 0, 'Pesos']);
  pesos.addRow(['04/06/2026', 'COMPRA SPY', 11, 19131.82, -212105.19, 8500.62, 'Pesos']);
  pesos.addRow(['04/06/2026', 'Ingreso de Fondos ', 0, 0, 220000, 220605.81, 'Pesos']);
  pesos.addRow(['08/05/2026', 'VENTA SPY', -2, 20000, 39800, 48474.36, 'Pesos']);

  const dolar = workbook.addWorksheet('DolarCV7000 Ext.');
  dolar.addRow(['Fecha', 'Descripción', 'Cantidad', 'Precio', 'Importe', 'Saldo', 'Moneda']);
  dolar.addRow(['30/04/2026', 'Dividendo en efectivo / SPY', 0, 0, 0.37, 0.37, 'Dolares']);

  const instrumentos = workbook.addWorksheet('Instrumentos');
  instrumentos.addRow(['Fecha', 'Descripción', 'Especie', 'Cantidad', 'Precio', 'Moneda']);
  instrumentos.addRow(['04/06/2026', 'COMPRA SPY', 'Spdr S&P 500', 11, 0, '']);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  sampleBuffer = Buffer.from(arrayBuffer);
});

describe('ppiParser', () => {
  it('detects a PPI workbook by its cash-ledger sheet headers', async () => {
    expect(await detectPpiWorkbook(sampleBuffer)).toBe(true);
    const notPpi = Buffer.from('not,a,workbook');
    expect(await detectPpiWorkbook(notPpi)).toBe(false);
  });

  it('parses a withdrawal row with null ticker', async () => {
    const { transactions } = await parsePpiWorkbook(sampleBuffer);
    const withdrawal = transactions.find((r) => r.type === 'withdrawal');
    expect(withdrawal).toBeDefined();
    expect(withdrawal!.ticker).toBeNull();
    expect(withdrawal!.currency).toBe('ARS');
    expect(withdrawal!.amountCents).toBe(850062n);
  });

  it('parses a buy row with ticker extracted from the description', async () => {
    const { transactions } = await parsePpiWorkbook(sampleBuffer);
    const buy = transactions.find((r) => r.type === 'buy');
    expect(buy).toBeDefined();
    expect(buy!.ticker).toBe('SPY');
    expect(buy!.quantity).toBe(11);
    expect(buy!.price).toBe(19131.82);
    expect(buy!.amountCents).toBe(21210519n);
  });

  it('parses a deposit row with null ticker', async () => {
    const { transactions } = await parsePpiWorkbook(sampleBuffer);
    const deposit = transactions.find((r) => r.type === 'deposit');
    expect(deposit).toBeDefined();
    expect(deposit!.ticker).toBeNull();
    expect(deposit!.amountCents).toBe(22000000n);
  });

  it('parses a sell row with a negative source quantity as a positive magnitude', async () => {
    const { transactions } = await parsePpiWorkbook(sampleBuffer);
    const sell = transactions.find((r) => r.type === 'sell');
    expect(sell).toBeDefined();
    expect(sell!.ticker).toBe('SPY');
    expect(sell!.quantity).toBe(2);
  });

  it('parses a dividend row from a USD sheet with ticker extracted after the slash', async () => {
    const { transactions } = await parsePpiWorkbook(sampleBuffer);
    const dividend = transactions.find((r) => r.type === 'dividend');
    expect(dividend).toBeDefined();
    expect(dividend!.ticker).toBe('SPY');
    expect(dividend!.currency).toBe('USD');
  });

  it('ignores the Instrumentos sheet', async () => {
    const { transactions, errors } = await parsePpiWorkbook(sampleBuffer);
    // Instrumentos has no Importe/Moneda columns, so its rows can never
    // appear in the result — confirmed indirectly by the total row count.
    expect(transactions).toHaveLength(5);
    expect(errors).toHaveLength(0);
  });

  it('collects a row-tagged error for an unrecognized description without dropping other rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pesos');
    sheet.addRow(['Fecha', 'Descripción', 'Cantidad', 'Precio', 'Importe', 'Saldo', 'Moneda']);
    sheet.addRow(['01/01/2026', 'Algo Desconocido', 0, 0, 100, 100, 'Pesos']);
    sheet.addRow(['02/01/2026', 'Ingreso de Fondos ', 0, 0, 5000, 5100, 'Pesos']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { transactions, errors } = await parsePpiWorkbook(buffer);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe('deposit');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ sheet: 'Pesos', row: 2 });
    expect(errors[0].message).toMatch(/unrecognized movement description/);
  });

  it('collects a row-tagged error for an unrecognized currency without dropping other rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pesos');
    sheet.addRow(['Fecha', 'Descripción', 'Cantidad', 'Precio', 'Importe', 'Saldo', 'Moneda']);
    sheet.addRow(['01/01/2026', 'Ingreso de Fondos ', 0, 0, 100, 100, 'Yenes']);
    sheet.addRow(['02/01/2026', 'Ingreso de Fondos ', 0, 0, 5000, 5100, 'Pesos']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { transactions, errors } = await parsePpiWorkbook(buffer);

    expect(transactions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ sheet: 'Pesos', row: 2 });
    expect(errors[0].message).toMatch(/unrecognized currency/);
  });

  it('collects a row-tagged error for a non-numeric amount without dropping other rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pesos');
    sheet.addRow(['Fecha', 'Descripción', 'Cantidad', 'Precio', 'Importe', 'Saldo', 'Moneda']);
    sheet.addRow(['01/01/2026', 'Ingreso de Fondos ', 0, 0, 'n/a', 100, 'Pesos']);
    sheet.addRow(['02/01/2026', 'Ingreso de Fondos ', 0, 0, 5000, 5100, 'Pesos']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { transactions, errors } = await parsePpiWorkbook(buffer);

    expect(transactions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ sheet: 'Pesos', row: 2 });
    expect(errors[0].message).toMatch(/non-numeric Importe/);
  });
});
