import { describe, it, expect } from 'vitest';
import { buildView, computeCashByCurrency, parseCsv } from '../static-app/src/portfolio';

// The "spread_zero" export: every trade has a matching EFECTIVO/LIQUIDEZ cash
// leg, plus an opening deposit. Cash must be derived from deposits/trades, the
// liquidity legs must not become an "ARS" position.
const CSV = [
  'nroTicket;nroComprobante;fechaEjecucion;fechaLiquidacion;tipoOperacion;instrumento;moneda;mercado;cantidad;precio;montoBruto;comision;ddmm;iva;otros;total',
  '1;900000001;01-09-2026;01-09-2026;Recibo De Cobro;;ARS;;;;30.000.310;0;0;0;0;30.000.310',
  '2;900000002;01-09-2026;01-09-2026;Compra;EFECTIVO / LIQUIDEZ (ARS);ARS;;30.000.310;1;-30.000.310;0;0;0;0;-30.000.310',
  '3;900000003;02-09-2026;03-09-2026;Compra;ON CAPEX S.A. CL.V 25/08/28 $ (CAC5O);ARS;BYMA;1;82.660;-82.660;0;0;0;0;-82.660',
  '4;900000004;02-09-2026;03-09-2026;Venta;EFECTIVO / LIQUIDEZ (ARS);ARS;;-82.660;1;82.660;0;0;0;0;82.660',
  '5;900000005;03-09-2026;04-09-2026;Compra;CEDEAR PEPSICO INC. (PEP);ARS;BYMA;338;12.400;-4.191.200;0;0;0;0;-4.191.200',
  '6;900000006;03-09-2026;04-09-2026;Venta;EFECTIVO / LIQUIDEZ (ARS);ARS;;-4.191.200;1;4.191.200;0;0;0;0;4.191.200',
  '11;900000011;04-09-2026;05-09-2026;Venta;ON CAPEX S.A. CL.V 25/08/28 $ (CAC5O);ARS;BYMA;-1;81.020;81.020;0;0;0;0;81.020',
  '12;900000012;04-09-2026;05-09-2026;Compra;EFECTIVO / LIQUIDEZ (ARS);ARS;;81.020;1;-81.020;0;0;0;0;-81.020',
].join('\n');

describe('cash liquidity from EFECTIVO/LIQUIDEZ exports', () => {
  const { transactions } = parseCsv(CSV);

  it('does not create a phantom cash position', () => {
    const view = buildView(transactions, {});
    expect(view.positions.some((p) => /ARS|EFECTIVO|LIQUIDEZ/i.test(p.ticker))).toBe(false);
    // The real bond round-trip nets to zero and PEP is held.
    expect(view.positions.some((p) => p.ticker === 'PEP')).toBe(true);
  });

  it('computes ARS cash = deposits − buys + sells (ignoring liquidity legs)', () => {
    const cash = computeCashByCurrency(transactions);
    // 30.000.310 − 82.660 − 4.191.200 + 81.020 = 25.807.470 (this trimmed subset)
    expect(cash.ARS).toBe(2580747000n);
    expect(cash.USD).toBe(0n);
  });

  it('still detects the format with a UTF-8 BOM and CRLF line endings', () => {
    const withBomCrlf = '\uFEFF' + CSV.replace(/\n/g, '\r\n');
    const { transactions: txs, errors } = parseCsv(withBomCrlf);
    expect(errors).toHaveLength(0);
    expect(txs.length).toBeGreaterThan(0);
    expect(computeCashByCurrency(txs).ARS).toBe(2580747000n);
  });
});
