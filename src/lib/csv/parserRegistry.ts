import { parse } from 'csv-parse/sync';
import { cocosParser } from './cocosParser';
import { cocosDetailedParser } from './cocosDetailedParser';
import { cocosHoldingsParser } from './cocosHoldingsParser';
import { bullMarketParser } from './bullMarketParser';
import type { BrokerParser, ParsedTransaction, RowError } from './types';

const PARSERS: BrokerParser[] = [cocosParser, cocosDetailedParser, cocosHoldingsParser, bullMarketParser];

export function detectAndParse(
  csvContent: string
): { brokerId: string; transactions: ParsedTransaction[]; errors: RowError[] } {
  // Real broker exports often carry a UTF-8 BOM and CRLF line endings, which
  // would leave "nroTicket" and "total\r" in the header and break every
  // exact-match detect(). Strip the BOM and normalize before sniffing.
  const clean = csvContent.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/)[0];
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const headers = (parse(firstLine, { columns: false, delimiter })[0] as string[]).map((h) => h.trim());

  const parser = PARSERS.find((p) => p.detect(headers));
  if (!parser) {
    throw new Error('No se reconoce el formato del CSV. Brokers soportados: Cocos Capital, Bull Market.');
  }

  const { transactions, errors } = parser.parse(clean);
  return { brokerId: parser.brokerId, transactions, errors };
}
