import { parse } from 'csv-parse/sync';
import { cocosParser } from './cocosParser';
import { cocosDetailedParser } from './cocosDetailedParser';
import { bullMarketParser } from './bullMarketParser';
import type { BrokerParser, ParsedTransaction, RowError } from './types';

const PARSERS: BrokerParser[] = [cocosParser, cocosDetailedParser, bullMarketParser];

export function detectAndParse(
  csvContent: string
): { brokerId: string; transactions: ParsedTransaction[]; errors: RowError[] } {
  const firstLine = csvContent.split('\n')[0];
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const headers = parse(firstLine, { columns: false, delimiter })[0] as string[];

  const parser = PARSERS.find((p) => p.detect(headers));
  if (!parser) {
    throw new Error('No se reconoce el formato del CSV. Brokers soportados: Cocos Capital, Bull Market.');
  }

  const { transactions, errors } = parser.parse(csvContent);
  return { brokerId: parser.brokerId, transactions, errors };
}
