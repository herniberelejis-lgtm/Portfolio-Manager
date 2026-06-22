import { describe, it, expect } from 'vitest';
import {
  buildFromMapping,
  distinctValues,
  guessMapping,
  guessType,
  parseAmountToCents,
  parseDateFlexible,
  parseDelimitedGrid,
  parseNumber,
  type ColumnMapping,
} from '../static-app/src/genericImport';

describe('parseDelimitedGrid', () => {
  it('parses comma-separated with header row', () => {
    const grid = parseDelimitedGrid('Fecha,Tipo,Monto\n01/02/2025,Compra,1000\n');
    expect(grid.headers).toEqual(['Fecha', 'Tipo', 'Monto']);
    expect(grid.rows).toEqual([['01/02/2025', 'Compra', '1000']]);
  });

  it('auto-detects semicolon delimiter', () => {
    const grid = parseDelimitedGrid('Fecha;Tipo;Monto\n01/02/2025;Venta;2000\n');
    expect(grid.headers).toEqual(['Fecha', 'Tipo', 'Monto']);
    expect(grid.rows[0]).toEqual(['01/02/2025', 'Venta', '2000']);
  });
});

describe('guessMapping', () => {
  it('matches Spanish broker headers (accent-insensitive)', () => {
    const m = guessMapping(['Fecha', 'Operación', 'Especie', 'Cantidad', 'Precio', 'Moneda', 'Importe']);
    expect(m.date).toBe(0);
    expect(m.type).toBe(1);
    expect(m.ticker).toBe(2);
    expect(m.quantity).toBe(3);
    expect(m.price).toBe(4);
    expect(m.currency).toBe(5);
    expect(m.amount).toBe(6);
  });

  it('leaves unknown fields at -1', () => {
    const m = guessMapping(['Col1', 'Col2']);
    expect(m.date).toBe(-1);
    expect(m.amount).toBe(-1);
  });
});

describe('guessType', () => {
  it('maps common Argentine operation labels', () => {
    expect(guessType('Compra Contado')).toBe('buy');
    expect(guessType('VENTA')).toBe('sell');
    expect(guessType('Acreditación dividendos')).toBe('dividend');
    expect(guessType('Comisión de mercado')).toBe('fee');
    expect(guessType('Depósito en pesos')).toBe('deposit');
    expect(guessType('Retiro de fondos')).toBe('withdrawal');
  });

  it('returns null for unknown labels', () => {
    expect(guessType('xyz')).toBeNull();
    expect(guessType('')).toBeNull();
  });
});

describe('parseNumber / parseAmountToCents', () => {
  it('parses Argentine format (comma decimals)', () => {
    expect(parseNumber('1.234,56', 'comma')).toBeCloseTo(1234.56);
    expect(parseNumber('$ 1.000,00', 'comma')).toBeCloseTo(1000);
  });

  it('parses US format (dot decimals)', () => {
    expect(parseNumber('1,234.56', 'dot')).toBeCloseTo(1234.56);
  });

  it('returns positive cents (magnitude only)', () => {
    expect(parseAmountToCents('-1.234,56', 'comma')).toBe(123456n);
    expect(parseAmountToCents('1234.56', 'dot')).toBe(123456n);
  });

  it('rejects non-numeric', () => {
    expect(parseNumber('', 'comma')).toBeNull();
    expect(parseAmountToCents('abc', 'comma')).toBeNull();
  });
});

describe('parseDateFlexible', () => {
  it('parses dd/mm/yyyy (day-first)', () => {
    const d = parseDateFlexible('03/02/2025')!;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(1); // February
    expect(d.getDate()).toBe(3);
  });

  it('parses ISO', () => {
    const d = parseDateFlexible('2025-02-03')!;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(1);
  });

  it('expands 2-digit years', () => {
    expect(parseDateFlexible('01/01/25')!.getFullYear()).toBe(2025);
  });

  it('returns null on garbage', () => {
    expect(parseDateFlexible('not a date')).toBeNull();
    expect(parseDateFlexible('')).toBeNull();
  });
});

describe('buildFromMapping (end-to-end)', () => {
  // Simulated IOL/Balanz-style export.
  const grid = parseDelimitedGrid(
    [
      'Fecha;Operacion;Simbolo;Cantidad;Precio;Moneda;Importe',
      '03/02/2025;Compra;GGAL;100;3.500,00;ARS;350.000,00',
      '10/03/2025;Venta;GGAL;60;5.200,00;ARS;312.000,00',
      '15/03/2025;Dividendos;GGAL;;;ARS;12.345,67',
      '20/03/2025;Algo Raro;XXX;1;1,00;ARS;100,00',
    ].join('\n'),
  );

  const mapping: ColumnMapping = {
    ...guessMapping(grid.headers),
    decimal: 'comma',
    defaultCurrency: 'ARS',
    typeMap: {},
  };

  it('builds transactions with correct values and currency', () => {
    const res = buildFromMapping(grid, mapping);
    expect(res.transactions).toHaveLength(3); // 3 valid, 1 unknown type
    const buy = res.transactions[0];
    expect(buy.type).toBe('buy');
    expect(buy.ticker).toBe('GGAL');
    expect(buy.quantity).toBe(100);
    expect(buy.price).toBeCloseTo(3500);
    expect(buy.currency).toBe('ARS');
    expect(buy.amountCents).toBe(35000000n);
  });

  it('collects unknown operation rows as errors', () => {
    const res = buildFromMapping(grid, mapping);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/no se reconoce la operación/i);
  });

  it('honors an explicit typeMap override', () => {
    const res = buildFromMapping(grid, { ...mapping, typeMap: { 'Algo Raro': 'fee' } });
    expect(res.transactions).toHaveLength(4);
    expect(res.transactions[3].type).toBe('fee');
  });

  it('keeps the original label in rawRow.tipoOperacion', () => {
    const res = buildFromMapping(grid, mapping);
    expect(res.transactions[0].rawRow.tipoOperacion).toBe('Compra');
  });

  it('distinctValues lists the operation labels', () => {
    expect(distinctValues(grid, mapping.type).sort()).toEqual(
      ['Algo Raro', 'Compra', 'Dividendos', 'Venta'].sort(),
    );
  });
});
