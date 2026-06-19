import { describe, it, expect } from 'vitest';
import { cocosDetailedParser } from '@/lib/csv/cocosDetailedParser';

const HEADER =
  'nroTicket;nroComprobante;fechaEjecucion;fechaLiquidacion;tipoOperacion;instrumento;moneda;mercado;cantidad;precio;montoBruto;comision;ddmm;iva;otros;total';

function row(fields: Record<string, string>): string {
  const order = [
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
  return order.map((key) => fields[key] ?? '').join(';');
}

describe('cocosDetailedParser', () => {
  it('detects the detailed Cocos headers', () => {
    expect(cocosDetailedParser.detect(HEADER.split(';'))).toBe(true);
    expect(cocosDetailedParser.detect(['Fecha', 'Tipo'])).toBe(false);
  });

  it('parses a buy row, extracting the ticker from instrumento', () => {
    const csv = [
      HEADER,
      row({
        nroTicket: '1',
        fechaEjecucion: '15-01-2026',
        tipoOperacion: 'Compra',
        instrumento: 'GRUPO GALICIA (GGAL)',
        moneda: 'ARS',
        cantidad: '10',
        precio: '5.000,00',
        total: '50.000,00',
      }),
    ].join('\n');

    const { transactions, errors } = cocosDetailedParser.parse(csv);

    expect(errors).toHaveLength(0);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe('buy');
    expect(transactions[0].ticker).toBe('GGAL');
    expect(transactions[0].quantity).toBe(10);
    expect(transactions[0].amountCents).toBe(5000000n);
    expect(transactions[0].date).toEqual(new Date(2026, 0, 15));
  });

  it('parses a sell row', () => {
    const csv = [
      HEADER,
      row({
        tipoOperacion: 'Venta',
        instrumento: 'CELULOSA ARGENTINA (CELU)',
        moneda: 'ARS',
        cantidad: '5',
        precio: '100,00',
        total: '500,00',
        fechaEjecucion: '20-01-2026',
      }),
    ].join('\n');

    const { transactions } = cocosDetailedParser.parse(csv);
    expect(transactions[0].type).toBe('sell');
    expect(transactions[0].ticker).toBe('CELU');
  });

  it('maps cash and fund movement types with no ticker', () => {
    const csv = [
      HEADER,
      row({ tipoOperacion: 'Recibo de cobro', instrumento: '', moneda: 'ARS', total: '1.000,00', fechaEjecucion: '01-01-2026' }),
      row({ tipoOperacion: 'Orden de pago', instrumento: '', moneda: 'ARS', total: '500,00', fechaEjecucion: '02-01-2026' }),
      row({ tipoOperacion: 'Dividendos', instrumento: 'GGAL', moneda: 'ARS', total: '10,00', fechaEjecucion: '03-01-2026' }),
    ].join('\n');

    const { transactions, errors } = cocosDetailedParser.parse(csv);

    expect(errors).toHaveLength(0);
    expect(transactions[0].type).toBe('deposit');
    expect(transactions[0].ticker).toBeNull();
    expect(transactions[1].type).toBe('withdrawal');
    expect(transactions[2].type).toBe('dividend');
    expect(transactions[2].ticker).toBeNull();
  });

  it('collects a row-tagged error for an unknown transaction type without dropping other rows', () => {
    const csv = [
      HEADER,
      row({ tipoOperacion: 'Compra', instrumento: 'GGAL', moneda: 'ARS', cantidad: '1', precio: '1,00', total: '1,00', fechaEjecucion: '01-01-2026' }),
      row({ tipoOperacion: 'Transferencia Rara', instrumento: '', moneda: 'ARS', total: '1,00', fechaEjecucion: '02-01-2026' }),
    ].join('\n');

    const { transactions, errors } = cocosDetailedParser.parse(csv);

    expect(transactions).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toContain('unknown transaction type');
  });

  it('collects a row-tagged error for an unparseable date', () => {
    const csv = [
      HEADER,
      row({ tipoOperacion: 'Compra', instrumento: 'GGAL', moneda: 'ARS', cantidad: '1', precio: '1,00', total: '1,00', fechaEjecucion: 'not-a-date' }),
    ].join('\n');

    const { transactions, errors } = cocosDetailedParser.parse(csv);

    expect(transactions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('unparseable date');
  });
});
