import { parse } from 'csv-parse/sync';
import type { BrokerParser, ParseResult, TransactionType } from './types';

/**
 * Real Cocos Capital "movimientos de cuenta" export: semicolon-delimited,
 * Argentine number formatting (`.` thousands, `,` decimal), tickers embedded
 * as a parenthetical suffix on `instrumento` (e.g. "CELULOSA ARGENTINA (CELU)"),
 * and many non-trade `tipoOperacion` values (cash transfers, MEP bond legs,
 * fund subscriptions/redemptions, stock dividends) alongside plain Compra/Venta.
 */

const HEADERS = [
  'nroTicket',
  'nroComprobante',
  'fechaEjecucion',
  'fechaLiquidacion',
  'tipoOperacion',
  'instrumento',
  'moneda',
  'mercado',
  'cantidad',
  'precio',
  'montoBruto',
  'comision',
  'ddmm',
  'iva',
  'otros',
  'total',
];

const TYPE_MAP: Record<string, TransactionType> = {
  venta: 'sell',
  compra: 'buy',
  'venta bono operatoria dolar mep ars': 'sell',
  'venta bono operatoria dolar mep usd': 'sell',
  'compra bono operatoria dolar mep ars': 'buy',
  'compra bono operatoria dolar mep usd': 'buy',
  'recibo de cobro dolares': 'deposit',
  'recibo de cobro': 'deposit',
  'orden de pago': 'withdrawal',
  'dividendos en especie': 'dividend',
  'dividendos usd': 'dividend',
  dividendos: 'dividend',
  'nota de credito conversion': 'deposit',
  'liquidacion suscripcion fci': 'buy',
  'liquidacion rescate fci': 'sell',
};

function parseArgNumber(value: string): number {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(normalized);
}

function toCents(value: string): bigint {
  return BigInt(Math.round(Math.abs(parseArgNumber(value)) * 100));
}

function parseDdMmYyyy(value: string): Date {
  // Cocos exports dates in two formats depending on the report: zero-padded
  // dash ("13-01-2026") and non-padded slash ("13/1/2026"). Accept both.
  const [day, month, year] = value.trim().split(/[-/]/).map(Number);
  if (!day || !month || !year || Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    throw new Error(`unparseable date "${value}"`);
  }
  return new Date(year, month - 1, day);
}

function extractTicker(instrumento: string): string | null {
  const match = instrumento.trim().match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : null;
}

export const cocosDetailedParser: BrokerParser = {
  brokerId: 'cocos-detailed',

  detect(headers: string[]): boolean {
    return HEADERS.every((h) => headers.includes(h));
  },

  parse(csvContent: string): ParseResult {
    const records: Record<string, string>[] = parse(csvContent, {
      columns: true,
      delimiter: ';',
      skip_empty_lines: true,
    });

    const result: ParseResult = { transactions: [], errors: [] };

    records.forEach((row, index) => {
      try {
        const tipoKey = row['tipoOperacion'].trim().toLowerCase();
        const type = TYPE_MAP[tipoKey];
        if (!type) {
          throw new Error(`Cocos detailed parser: unknown transaction type "${row['tipoOperacion']}"`);
        }

        const instrumento = row['instrumento']?.trim() ?? '';
        const ticker = instrumento ? extractTicker(instrumento) : null;
        const isTrade = type === 'buy' || type === 'sell';

        result.transactions.push({
          date: parseDdMmYyyy(row['fechaEjecucion']),
          type,
          ticker: isTrade ? ticker : null,
          quantity: isTrade && row['cantidad']?.trim() ? Math.abs(parseArgNumber(row['cantidad'])) : null,
          price: isTrade && row['precio']?.trim() ? Math.abs(parseArgNumber(row['precio'])) : null,
          currency: row['moneda'].trim() as 'ARS' | 'USD',
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
