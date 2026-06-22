// Generic, broker-agnostic importer. When the file doesn't match any known
// broker format (Cocos / Bull Market / PPI), the user maps each of their
// columns to our fields in a small UI (ColumnMapper) and this module turns the
// raw grid into ParsedTransactions. It deliberately handles the messy reality
// of Argentine broker exports: dd/mm/yyyy dates, "1.234,56" amounts, and free
// text operation labels like "Compra Contado" or "Acreditación dividendos".
import { parse } from 'csv-parse/sync';
import type { ParseResult, TransactionType } from '../../src/lib/csv/types';

export interface GridData {
  headers: string[];
  rows: string[][];
}

export interface ColumnMapping {
  date: number; // index into headers, or -1 when unmapped
  type: number;
  ticker: number;
  quantity: number;
  price: number;
  currency: number;
  amount: number;
  defaultCurrency: 'ARS' | 'USD'; // used when the currency column is unmapped
  decimal: 'comma' | 'dot'; // "1.234,56" (comma) vs "1,234.56" (dot)
  typeMap: Record<string, TransactionType>; // raw operation label -> our type
}

/** Split a delimited (CSV) text into a header row + data rows. The delimiter is
 *  auto-detected (`;` or `,`) like the broker registry does. The first
 *  non-empty line is treated as the header row. */
export function parseDelimitedGrid(text: string): GridData {
  const firstLine = text.split('\n').find((l) => l.trim() !== '') ?? '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const matrix: string[][] = parse(text, {
    columns: false,
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  if (matrix.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = matrix;
  return { headers: headers.map((h) => String(h ?? '').trim()), rows };
}

const NORM = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accent diacritics
    .trim();

// Header keywords (normalized, accent-free) we look for to pre-fill the mapping.
const HEADER_HINTS: Record<keyof Omit<ColumnMapping, 'defaultCurrency' | 'decimal' | 'typeMap'>, string[]> = {
  date: ['fecha', 'date', 'concertacion', 'liquidacion', 'dia'],
  type: ['tipo', 'operacion', 'movimiento', 'descripcion', 'concepto', 'detalle', 'operation'],
  ticker: ['ticker', 'simbolo', 'especie', 'symbol', 'activo', 'instrumento', 'papel'],
  quantity: ['cantidad', 'nominales', 'qty', 'quantity', 'nominal'],
  price: ['precio', 'price', 'cotizacion', 'valor unitario', 'pu'],
  currency: ['moneda', 'currency', 'divisa'],
  amount: ['importe', 'monto', 'total', 'neto', 'bruto', 'amount', 'importe neto'],
};

/** Best-effort initial mapping by fuzzy-matching the file's headers. Unmatched
 *  fields stay at -1 so the user picks them by hand. */
export function guessMapping(headers: string[]): ColumnMapping {
  const norm = headers.map(NORM);
  const find = (keys: string[]): number => {
    // Prefer an exact-ish match, then a contains match.
    for (const k of keys) {
      const exact = norm.findIndex((h) => h === k);
      if (exact >= 0) return exact;
    }
    for (const k of keys) {
      const part = norm.findIndex((h) => h.includes(k));
      if (part >= 0) return part;
    }
    return -1;
  };
  return {
    date: find(HEADER_HINTS.date),
    type: find(HEADER_HINTS.type),
    ticker: find(HEADER_HINTS.ticker),
    quantity: find(HEADER_HINTS.quantity),
    price: find(HEADER_HINTS.price),
    currency: find(HEADER_HINTS.currency),
    amount: find(HEADER_HINTS.amount),
    defaultCurrency: 'ARS',
    decimal: 'comma',
    typeMap: {},
  };
}

/** Map a free-text operation label to one of our transaction types. Returns
 *  null when nothing matches so the caller can ask the user to decide. */
export function guessType(label: string): TransactionType | null {
  const s = NORM(label);
  if (!s) return null;
  if (/\b(venta|vendi|sell|enajenacion)\b|venta/.test(s)) return 'sell';
  if (/\b(compra|compre|buy|suscrip)\b|compra/.test(s)) return 'buy';
  if (/dividend|renta|cupon|amortizac/.test(s)) return 'dividend';
  if (/comision|arancel|fee|impuesto|iva|derecho|gasto|retencion/.test(s)) return 'fee';
  if (/(deposito|ingreso|acreditac|transferencia recibida|recibid|credito)/.test(s)) return 'deposit';
  if (/(retiro|egreso|extraccion|debito|transferencia enviada|enviad)/.test(s)) return 'withdrawal';
  return null;
}

/** Distinct non-empty values found in a given column (for the type-mapping UI). */
export function distinctValues(grid: GridData, col: number): string[] {
  if (col < 0) return [];
  const seen = new Set<string>();
  for (const row of grid.rows) {
    const v = (row[col] ?? '').trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

/** Parse a number written in either Argentine ("1.234,56") or US ("1,234.56")
 *  style, ignoring currency symbols and spaces. Returns null when not numeric. */
export function parseNumber(raw: string, decimal: 'comma' | 'dot'): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-' || s === '.' || s === ',') return null;
  if (decimal === 'comma') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Money magnitude in integer cents (always positive — the type carries the
 *  direction). Returns null when the value isn't a valid number. */
export function parseAmountToCents(raw: string, decimal: 'comma' | 'dot'): bigint | null {
  const n = parseNumber(raw, decimal);
  if (n === null) return null;
  return BigInt(Math.round(Math.abs(n) * 100));
}

/** Parse the common date shapes seen in AR broker exports: ISO (yyyy-mm-dd),
 *  dd/mm/yyyy and dd-mm-yyyy (and 2-digit years). Returns null when invalid. */
export function parseDateFlexible(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // ISO first (optionally with a time component).
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // dd/mm/yyyy or dd-mm-yyyy (Argentine day-first convention).
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function normalizeCurrency(raw: string, fallback: 'ARS' | 'USD'): 'ARS' | 'USD' {
  const s = NORM(raw);
  if (/usd|u\$|us\$|dol/.test(s)) return 'USD';
  if (/ars|peso|\$/.test(s)) return 'ARS';
  return fallback;
}

/** Turn the raw grid into transactions using the user's column mapping.
 *  Per-row failures are collected (never abort the file), mirroring the
 *  broker-specific parsers. */
export function buildFromMapping(grid: GridData, m: ColumnMapping): ParseResult {
  const out: ParseResult = { transactions: [], errors: [] };
  grid.rows.forEach((cells, i) => {
    const rowNum = i + 1;
    const cell = (idx: number): string => (idx >= 0 && idx < cells.length ? (cells[idx] ?? '').trim() : '');
    try {
      const rawDate = cell(m.date);
      const date = parseDateFlexible(rawDate);
      if (!date) throw new Error(`fecha inválida: "${rawDate}"`);

      const rawType = cell(m.type);
      const type = m.typeMap[rawType] ?? guessType(rawType);
      if (!type) throw new Error(`no se reconoce la operación: "${rawType}"`);

      const amountCents = parseAmountToCents(cell(m.amount), m.decimal);
      if (amountCents === null) throw new Error(`monto inválido: "${cell(m.amount)}"`);

      const tickerRaw = cell(m.ticker);
      const qty = m.quantity >= 0 ? parseNumber(cell(m.quantity), m.decimal) : null;
      const price = m.price >= 0 ? parseNumber(cell(m.price), m.decimal) : null;
      const currency = m.currency >= 0 ? normalizeCurrency(cell(m.currency), m.defaultCurrency) : m.defaultCurrency;

      const rawRow: Record<string, string> = {};
      grid.headers.forEach((h, idx) => {
        rawRow[h || `col${idx}`] = cells[idx] ?? '';
      });
      // Keep the original label so opLabel()/MEP-FCI exclusion still work.
      rawRow.tipoOperacion = rawType;

      out.transactions.push({
        date,
        type,
        ticker: tickerRaw ? tickerRaw.toUpperCase() : null,
        quantity: qty === null ? null : Math.abs(qty),
        price: price === null ? null : Math.abs(price),
        currency,
        amountCents,
        rawRow,
      });
    } catch (e) {
      out.errors.push({ row: rowNum, message: (e as Error).message });
    }
  });
  return out;
}
