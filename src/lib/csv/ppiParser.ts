import ExcelJS from 'exceljs';
import type { ParsedTransaction, TransactionType } from './types';

/**
 * PPI exports a multi-sheet XLSX, not a single CSV: one cash-ledger sheet per
 * currency ("Pesos", "DolarCV..." etc.) plus an "Instrumentos" sheet (asset
 * detail only, no transaction amounts) that this parser ignores. Because the
 * source is binary, ppiParser does not implement the text-based BrokerParser
 * contract (`detect(headers)` / `parse(csvContent: string)`); it exposes its
 * own buffer-based functions instead. The import endpoint (Task 5) dispatches
 * to this parser by file extension (.xlsx) rather than by sniffing headers.
 *
 * Per-row failures (unrecognized description, bad currency, non-numeric
 * amount, etc.) must not abort the rest of the file, so parsePpiWorkbook
 * collects them as row-tagged errors instead of throwing.
 */

export interface PpiRowError {
  sheet: string;
  row: number;
  message: string;
}

export interface PpiParseResult {
  transactions: ParsedTransaction[];
  errors: PpiRowError[];
}

function currencyFromMoneda(moneda: string): 'ARS' | 'USD' {
  const trimmed = moneda.trim().toUpperCase();
  if (trimmed === 'PESOS' || trimmed === 'ARS') return 'ARS';
  if (trimmed === 'DOLARES' || trimmed === 'USD' || trimmed.startsWith('DOLAR')) return 'USD';
  throw new Error(`unrecognized currency "${moneda}"`);
}

function parseDescripcion(descripcion: string): { type: TransactionType; ticker: string | null } {
  const trimmed = descripcion.trim();

  if (/^Retiro de Fondos/i.test(trimmed)) return { type: 'withdrawal', ticker: null };
  if (/^Ingreso de Fondos/i.test(trimmed)) return { type: 'deposit', ticker: null };

  let match = trimmed.match(/^COMPRA\s+(\S+)/i);
  if (match) return { type: 'buy', ticker: match[1] };

  match = trimmed.match(/^VENTA\s+(\S+)/i);
  if (match) return { type: 'sell', ticker: match[1] };

  match = trimmed.match(/^Dividendo en efectivo\s*\/\s*(\S+)/i);
  if (match) return { type: 'dividend', ticker: match[1] };

  throw new Error(`unrecognized movement description "${descripcion}"`);
}

function excelDateToJsDate(value: ExcelJS.CellValue): Date {
  if (value instanceof Date) return value;
  // PPI dates come through as "DD/MM/YYYY" strings.
  const str = String(value).trim();
  const parts = str.split('/').map(Number);
  const day = parts[0];
  const month = parts[1];
  const year = parts[2];
  if (!day || !month || !year || Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    throw new Error(`unparseable date "${str}"`);
  }
  return new Date(year, month - 1, day);
}

function parseAmount(raw: ExcelJS.CellValue, fieldName: string): number {
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`non-numeric ${fieldName} "${String(raw)}"`);
  }
  return value;
}

function rowToParsedTransaction(row: ExcelJS.Row, headerIndex: Record<string, number>): ParsedTransaction {
  const get = (header: string) => row.getCell(headerIndex[header]).value;

  const descripcion = String(get('Descripción') ?? '').trim();
  const { type, ticker } = parseDescripcion(descripcion);

  const currency = currencyFromMoneda(String(get('Moneda') ?? ''));

  const cantidadRaw = get('Cantidad');
  const precioRaw = get('Precio');
  const importeRaw = get('Importe');

  const quantity = type === 'buy' || type === 'sell' ? Math.abs(parseAmount(cantidadRaw, 'Cantidad')) : null;
  const price = type === 'buy' || type === 'sell' ? Math.abs(parseAmount(precioRaw, 'Precio')) : null;
  const amountCents = BigInt(Math.round(Math.abs(parseAmount(importeRaw, 'Importe')) * 100));

  const rawRow: Record<string, string> = {};
  for (const [header, col] of Object.entries(headerIndex)) {
    rawRow[header] = String(row.getCell(col).value ?? '');
  }

  return {
    date: excelDateToJsDate(get('Fecha')),
    type,
    ticker,
    quantity,
    price,
    currency,
    amountCents,
    rawRow,
  };
}

function buildHeaderIndex(headerRow: ExcelJS.Row): Record<string, number> {
  const index: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    index[String(cell.value).trim()] = colNumber;
  });
  return index;
}

const IGNORED_SHEETS = new Set(['Instrumentos']);
const REQUIRED_HEADERS = ['Fecha', 'Descripción', 'Cantidad', 'Precio', 'Importe', 'Moneda'];

export async function detectPpiWorkbook(buffer: Buffer): Promise<boolean> {
  try {
    const workbook = new ExcelJS.Workbook();
    // exceljs's bundled type definitions reference an incompatible Buffer type from a different @types/node version.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
    return workbook.worksheets.some((sheet) => {
      if (IGNORED_SHEETS.has(sheet.name)) return false;
      const header = buildHeaderIndex(sheet.getRow(1));
      return ['Fecha', 'Descripción', 'Cantidad', 'Precio', 'Importe', 'Saldo', 'Moneda'].every(
        (h) => h in header
      );
    });
  } catch {
    return false;
  }
}

export async function parsePpiWorkbook(buffer: Buffer): Promise<PpiParseResult> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const transactions: ParsedTransaction[] = [];
  const errors: PpiRowError[] = [];

  for (const sheet of workbook.worksheets) {
    if (IGNORED_SHEETS.has(sheet.name)) continue;

    const headerIndex = buildHeaderIndex(sheet.getRow(1));
    const hasExpectedHeaders = REQUIRED_HEADERS.every((h) => h in headerIndex);
    if (!hasExpectedHeaders) continue;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const fecha = row.getCell(headerIndex['Fecha']).value;
      if (!fecha) return; // skip blank trailing rows

      try {
        transactions.push(rowToParsedTransaction(row, headerIndex));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        errors.push({ sheet: sheet.name, row: rowNumber, message });
      }
    });
  }

  return { transactions, errors };
}

export const ppiParser = {
  brokerId: 'ppi' as const,
  detectBuffer: detectPpiWorkbook,
  parseBuffer: parsePpiWorkbook,
};
