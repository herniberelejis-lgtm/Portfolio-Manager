import { describe, it, expect } from 'vitest';
import { computePosition } from '@/lib/pnl/engine';
import type { PositionInput } from '@/lib/pnl/engine';

describe('computePosition', () => {
  it('computes weighted average cost across two buys', () => {
    const txs: PositionInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n },
      { type: 'buy', quantity: 10, amountCents: 6000000n },
    ];

    const result = computePosition(txs, 70000n);

    expect(result.quantity).toBe(20);
    expect(result.avgCostCents).toBe(550000n);
    expect(result.marketValueCents).toBe(1400000n);
    expect(result.unrealizedPnlCents).toBe(-9600000n);
  });

  it('reduces quantity and realizes proportional gain on a sell, keeping avg cost stable', () => {
    const txs: PositionInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n },
      { type: 'sell', quantity: 4, amountCents: 2400000n },
    ];

    const result = computePosition(txs, 60000n);

    expect(result.quantity).toBe(6);
    expect(result.avgCostCents).toBe(500000n);
    expect(result.realizedPnlCents).toBe(400000n);
  });

  it('excludes deposit and withdrawal transactions from position calculations', () => {
    const txs: PositionInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n },
      { type: 'deposit', quantity: null, amountCents: 100000000n },
    ];

    const result = computePosition(txs, 60000n);

    expect(result.quantity).toBe(10);
  });

  it('returns zero position when there are no buy/sell transactions', () => {
    const result = computePosition([], 0n);
    expect(result.quantity).toBe(0);
    expect(result.avgCostCents).toBe(0n);
    expect(result.unrealizedPnlCents).toBe(0n);
    expect(result.realizedPnlCents).toBe(0n);
  });
});
