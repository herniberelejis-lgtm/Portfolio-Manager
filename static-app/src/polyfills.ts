// csv-parse (and exceljs) reference Node's Buffer/global at module load. In the
// browser those don't exist, which crashes the app on import. Provide them
// before any of that code runs. This file must be imported first in main.tsx.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: unknown; global?: unknown };
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;
if (typeof g.global === 'undefined') g.global = globalThis;
