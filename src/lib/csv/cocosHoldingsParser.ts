import { parse } from 'csv-parse/sync';
import type { BrokerParser, ParseResult } from './types';

/**
 * Cocos "portfolio report" / tenencias export: a snapshot of CURRENT positions
 * (no transaction history), one row per instrument:
 *   instrumento;cantidad;precio;moneda;total
 * For users who only want to track what they hold today, each position is
 * imported as a single synthetic buy at the snapshot price, so the app can show
 * holdings, composition, concentration, USD value and exposure. (P&L/ROI history
 * isn't available because the file has no purchase prices.)
 */

const HEADERS = ['instrumento', 'cantidad', 'precio', 'moneda', 'total'];

function parseArgNumber(value: string): number {
  return parseFloat(value.trim().replace(/\./g, '').replace(',', '.'));
}

function toCents(value: string): bigint {
  return BigInt(Math.round(Math.abs(parseArgNumber(value)) * 100));
}

function extractTicker(instrumento: string): string | null {
  const match = instrumento.trim().match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : null;
}

export const cocosHoldingsParser: BrokerParser = {
  brokerId: 'cocos-holdings',

  detect(headers: string[]): boolean {
    const h = headers.map((x) => x.trim().toLowerCase());
    return (
      HEADERS.every((x) => h.includes(x)) &&
      !h.includes('tipooperacion') &&
      !h.includes('fechaejecucion')
    );
  },

  parse(csvContent: string): ParseResult {
    const records: Record<string, string>[] = parse(csvContent, {
      columns: true,
      delimiter: ';',
      skip_empty_lines: true,
    });

    const result: ParseResult = { transactions: [], errors: [] };
    // Day-granularity "as of" date so re-importing the same snapshot de-dups.
    const date = new Date(new Date().toISOString().slice(0, 10));

    records.forEach((row, index) => {
      try {
        const ticker = extractTicker(row['instrumento'] ?? '');
        if (!ticker) return; // cash balance rows (ARS / USD / EXT) have no ticker
        const quantity = row['cantidad'] ? Math.abs(parseArgNumber(row['cantidad'])) : null;
        if (!quantity) return;

        result.transactions.push({
          date,
          type: 'buy',
          ticker,
          quantity,
          price: row['precio'] ? Math.abs(parseArgNumber(row['precio'])) : null,
          currency: row['moneda']?.trim() === 'USD' ? 'USD' : 'ARS',
          amountCents: toCents(row['total']),
          rawRow: row,
        });
      } catch (e) {
        result.errors.push({ row: index + 1, message: (e as Error).message });
      }
    });

    return result;
  },
};
