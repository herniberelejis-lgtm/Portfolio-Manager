export type TransactionType = 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'fee';

export interface ParsedTransaction {
  date: Date;
  type: TransactionType;
  ticker: string | null; // null for deposit/withdrawal/fee with no associated asset
  quantity: number | null;
  price: number | null;
  currency: 'ARS' | 'USD';
  amountCents: bigint;
  rawRow: Record<string, string>;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: RowError[];
}

export interface BrokerParser {
  brokerId: string;
  /** Returns true if the CSV headers match this broker's export format. */
  detect(headers: string[]): boolean;
  /** Malformed rows are reported in `errors`, never abort the rest of the file. */
  parse(csvContent: string): ParseResult;
}
