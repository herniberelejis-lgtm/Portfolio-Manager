// Parser for the "Copa BYMA" tracking spreadsheet (a hand-built workbook, not a
// broker export). The orders live on a sheet named "Base Operaciones" with the
// columns: Operación | Activo | Monto | Nominales | Precio | TC IMPLICITO.
//
// This sheet has no dates and mixes ARS and USD rows with different price
// conventions, so we normalize with rules tuned to this format:
//   • amount   = Monto when present, else Nominales × Precio.
//   • currency = USD when the unit price is small (< 100, i.e. a USD bond/ON
//                price like 1.035 or 0.5586), otherwise ARS. This also splits
//                a peso buy (price 85.450) from its USD sell (price 0.5586).
//   • bonds/ONs (tickers containing a digit, e.g. AL30D, TTC8D) are tagged so
//     the app values them at cost instead of a bogus live price.
// All operations get a single date chosen by the user.
import type { ParsedTransaction, RowError } from '../../src/lib/csv/types';

export interface CopaResult {
  transactions: ParsedTransaction[];
  errors: RowError[];
}

// Single date for every operation (the sheet carries none). 2026-09-04 = "el
// viernes" the user asked for. Local midnight so it renders on the right day.
const OP_DATE = new Date(2026, 8, 4);

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if ('result' in o) return String(o.result ?? '');
    if (Array.isArray(o.richText)) return o.richText.map((t) => (t as { text?: string }).text ?? '').join('');
    return String(v);
  }
  return String(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = cellToString(v).trim().replace(/[^0-9,.-]/g, '');
  if (!s) return null;
  // Argentine "1.234,56" vs plain "1234.56": if it has a comma, treat comma as
  // the decimal separator and dots as thousands.
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : null;
}

function norm(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
}

function isOpsHeader(cells: string[]): boolean {
  const set = cells.map(norm);
  return set.includes('operacion') && set.includes('activo') && set.some((c) => c.startsWith('nominal'));
}

/** Parse the "Base Operaciones" sheet of a Copa BYMA workbook. Returns null if
 *  the workbook doesn't look like this format (so callers can fall back). */
export async function parseCopaBymaWorkbook(buffer: ArrayBuffer): Promise<CopaResult | null> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Buffer);

  // Read each sheet as a plain string matrix.
  const sheets = wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const vals = (row.values as unknown[]).slice(1);
      rows.push(vals.map((v) => cellToString(v).trim()));
    });
    return { name: ws.name, rows };
  });

  // Prefer the sheet literally named "Base Operaciones"; else any sheet with the
  // ops header.
  let target = sheets.find((s) => /base\s*operaciones/i.test(s.name));
  let headerIdx = -1;
  if (target) {
    headerIdx = target.rows.findIndex(isOpsHeader);
  } else {
    for (const s of sheets) {
      const idx = s.rows.findIndex(isOpsHeader);
      if (idx >= 0) {
        target = s;
        headerIdx = idx;
        break;
      }
    }
  }
  if (!target || headerIdx < 0) return null;

  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];

  for (let i = headerIdx + 1; i < target.rows.length; i++) {
    const r = target.rows[i];
    const op = (r[0] ?? '').trim();
    // Stop at the "Compras Pendientes" block, a repeated header, or a blank gap.
    if (!op) break;
    if (/compras?\s*pendientes/i.test(op) || norm(op) === 'operacion') break;

    const lower = norm(op);
    const type: ParsedTransaction['type'] | null = lower.startsWith('venta')
      ? 'sell'
      : lower.startsWith('compra')
        ? 'buy'
        : null;
    const ticker = (r[1] ?? '').trim().toUpperCase();
    if (!type || !ticker) {
      errors.push({ row: i + 1, message: `No se reconoce la operación "${op}" / activo "${ticker}"` });
      continue;
    }

    const monto = toNumber(r[2]);
    const nominales = toNumber(r[3]);
    const precio = toNumber(r[4]);
    const amount = monto != null ? monto : nominales != null && precio != null ? nominales * precio : null;
    if (amount == null) {
      errors.push({ row: i + 1, message: `${ticker}: falta el monto (o nominales × precio)` });
      continue;
    }

    // Small unit price ⇒ USD (bond/ON quoted per nominal); large ⇒ ARS.
    const currency: 'ARS' | 'USD' = precio != null && precio < 100 ? 'USD' : 'ARS';
    // Bonds/ONs here are either USD-settled (TTC8D, MGCTD, CAC5D) or carry a
    // digit in the ticker (AL30D, CAC50O); the ARS equities are PEP/UBER/VST.
    // Tag bonds so the app values them at cost (no reliable live price), like
    // the GD35 fix.
    const isBond = currency === 'USD' || /\d/.test(ticker);

    transactions.push({
      date: OP_DATE,
      type,
      ticker,
      quantity: nominales,
      price: precio,
      currency,
      amountCents: BigInt(Math.round(Math.abs(amount) * 100)),
      rawRow: {
        instrumento: isBond ? `ON ${ticker}` : ticker,
        tipoOperacion: op,
        tcImplicito: (r[5] ?? '').trim(),
      },
    });
  }

  return { transactions, errors };
}
