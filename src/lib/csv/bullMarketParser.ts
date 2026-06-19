import { parse } from 'csv-parse/sync';
import type { BrokerParser, ParseResult, TransactionType } from './types';

const BULLMARKET_HEADERS = ['Date', 'Operation', 'Symbol', 'Qty', 'Price', 'Currency', 'Total'];

const TYPE_MAP: Record<string, TransactionType> = {
  BUY: 'buy',
  SELL: 'sell',
  DIVIDEND: 'dividend',
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  FEE: 'fee',
};

function toCents(value: string): bigint {
  return BigInt(Math.round(parseFloat(value.trim()) * 100));
}

export const bullMarketParser: BrokerParser = {
  brokerId: 'bullmarket',

  detect(headers: string[]): boolean {
    return BULLMARKET_HEADERS.every((h) => headers.includes(h));
  },

  parse(csvContent: string): ParseResult {
    const records: Record<string, string>[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    const result: ParseResult = { transactions: [], errors: [] };

    records.forEach((row, index) => {
      try {
        const type = TYPE_MAP[row['Operation'].trim()];
        if (!type) {
          throw new Error(`Bull Market parser: unknown operation "${row['Operation']}"`);
        }

        result.transactions.push({
          date: new Date(row['Date']),
          type,
          ticker: row['Symbol']?.trim() ? row['Symbol'].trim() : null,
          quantity: row['Qty']?.trim() ? parseFloat(row['Qty']) : null,
          price: row['Price']?.trim() ? parseFloat(row['Price']) : null,
          currency: row['Currency'].trim() as 'ARS' | 'USD',
          amountCents: toCents(row['Total']),
          rawRow: row,
        });
      } catch (e) {
        result.errors.push({ row: index + 1, message: (e as Error).message });
      }
    });

    return result;
  },
};
