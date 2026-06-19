import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { detectAndParse } from '@/lib/csv/parserRegistry';

const cocosCsv = readFileSync(path.join(process.cwd(), 'tests/fixtures/cocos-sample.csv'), 'utf-8');
const bullCsv = readFileSync(path.join(process.cwd(), 'tests/fixtures/bullmarket-sample.csv'), 'utf-8');

describe('detectAndParse', () => {
  it('detects Cocos CSV and parses with cocosParser', () => {
    const result = detectAndParse(cocosCsv);
    expect(result.brokerId).toBe('cocos');
    expect(result.transactions).toHaveLength(4);
    expect(result.errors).toHaveLength(0);
  });

  it('detects Bull Market CSV and parses with bullMarketParser', () => {
    const result = detectAndParse(bullCsv);
    expect(result.brokerId).toBe('bullmarket');
    expect(result.transactions).toHaveLength(4);
    expect(result.errors).toHaveLength(0);
  });

  it('throws a clear error when no parser matches', () => {
    expect(() => detectAndParse('foo,bar\n1,2')).toThrow(/no se reconoce el formato/i);
  });
});
