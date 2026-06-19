import { describe, it, expect } from 'vitest';
import { computePositionTimeline } from '@/lib/pnl/engine';
import type { TimelineInput } from '@/lib/pnl/engine';

describe('computePositionTimeline', () => {
  it('emits a cost-increasing event for a buy', () => {
    const txs: TimelineInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n, date: new Date('2026-01-01') },
    ];

    const events = computePositionTimeline(txs);

    expect(events).toHaveLength(1);
    expect(events[0].costDeltaCents).toBe(5000000n);
    expect(events[0].realizedPnlDeltaCents).toBe(0n);
  });

  it('emits a cost-decreasing event with realized P&L on a sell', () => {
    const txs: TimelineInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n, date: new Date('2026-01-01') },
      { type: 'sell', quantity: 4, amountCents: 2400000n, date: new Date('2026-01-15') },
    ];

    const events = computePositionTimeline(txs);

    expect(events).toHaveLength(2);
    expect(events[1].costDeltaCents).toBe(-2000000n);
    expect(events[1].realizedPnlDeltaCents).toBe(400000n);
  });

  it('skips a sell when there is no existing quantity', () => {
    const txs: TimelineInput[] = [
      { type: 'sell', quantity: 4, amountCents: 2400000n, date: new Date('2026-01-15') },
    ];

    const events = computePositionTimeline(txs);

    expect(events).toHaveLength(0);
  });

  it('ignores deposit and withdrawal transactions', () => {
    const txs: TimelineInput[] = [
      { type: 'buy', quantity: 10, amountCents: 5000000n, date: new Date('2026-01-01') },
      { type: 'deposit', quantity: null, amountCents: 100000000n, date: new Date('2026-01-05') },
      { type: 'withdrawal', quantity: null, amountCents: 50000000n, date: new Date('2026-01-06') },
    ];

    const events = computePositionTimeline(txs);

    expect(events).toHaveLength(1);
  });

  it('returns an empty array when there are no transactions', () => {
    expect(computePositionTimeline([])).toEqual([]);
  });
});
