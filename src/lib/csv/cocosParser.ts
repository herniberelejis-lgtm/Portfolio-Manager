import { parse } from 'csv-parse/sync';
import type { BrokerParser, ParseResult, TransactionType } from './types';

const COCOS_HEADERS = ['Fecha', 'Tipo', 'Ticker', 'Cantidad', 'Precio', 'Moneda', 'Importe'];

const TYPE_MAP: Record<string, TransactionType> = {
  Compra: 'buy',
  Venta: 'sell',
  Dividendo: 'dividend',
  'Ingreso de fondos': 'deposit',
  'Retiro de fondos': 'withdrawal',
  Comisión: 'fee',
};

function toCents(value: string): bigint {
  const normalized = value.trim().replace(',', '.');
  return BigInt(Math.round(parseFloat(normalized) * 100));
}

export const cocosParser: BrokerParser = {
  brokerId: 'cocos',

  detect(headers: string[]): boolean {
    return COCOS_HEADERS.every((h) => headers.includes(h));
  },

  parse(csvContent: string): ParseResult {
    const records: Record<string, string>[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    const result: ParseResult = { transactions: [], errors: [] };

    records.forEach((row, index) => {
      try {
        const type = TYPE_MAP[row['Tipo'].trim()];
        if (!type) {
          throw new Error(`Cocos parser: unknown transaction type "${row['Tipo']}"`);
        }

        result.transactions.push({
          date: new Date(row['Fecha']),
          type,
          ticker: row['Ticker']?.trim() ? row['Ticker'].trim() : null,
          quantity: row['Cantidad']?.trim() ? parseFloat(row['Cantidad']) : null,
          price: row['Precio']?.trim() ? parseFloat(row['Precio']) : null,
          currency: row['Moneda'].trim() as 'ARS' | 'USD',
          amountCents: toCents(row['Importe']),
          rawRow: row,
        });
      } catch (e) {
        result.errors.push({ row: index + 1, message: (e as Error).message });
      }
    });

    return result;
  },
};
