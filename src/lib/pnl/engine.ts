export interface PositionInput {
  type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'fee';
  quantity: number | null;
  amountCents: bigint;
  date?: Date;
}

export interface TimelineInput extends PositionInput {
  date: Date;
}

export interface TimelineEvent {
  date: Date;
  costDeltaCents: bigint;
  realizedPnlDeltaCents: bigint;
}

export function computePositionTimeline(transactions: TimelineInput[]): TimelineEvent[] {
  let quantity = 0;
  let totalCostCents = 0n;
  const events: TimelineEvent[] = [];

  for (const tx of transactions) {
    if (tx.type === 'buy' && tx.quantity) {
      quantity += tx.quantity;
      totalCostCents += tx.amountCents;
      events.push({ date: tx.date, costDeltaCents: tx.amountCents, realizedPnlDeltaCents: 0n });
    } else if (tx.type === 'sell' && tx.quantity) {
      if (quantity <= 0) continue;
      const soldFraction = tx.quantity / quantity;
      const costOfSoldUnits = BigInt(Math.round(Number(totalCostCents) * soldFraction));
      const realizedPnlDeltaCents = tx.amountCents - costOfSoldUnits;
      totalCostCents -= costOfSoldUnits;
      quantity -= tx.quantity;
      events.push({ date: tx.date, costDeltaCents: -costOfSoldUnits, realizedPnlDeltaCents });
    }
  }

  return events;
}

export interface PositionResult {
  quantity: number;
  avgCostCents: bigint;
  marketValueCents: bigint;
  unrealizedPnlCents: bigint;
  realizedPnlCents: bigint;
}

export function computePosition(transactions: PositionInput[], currentPriceCents: bigint): PositionResult {
  let quantity = 0;
  let totalCostCents = 0n;
  let realizedPnlCents = 0n;

  for (const tx of transactions) {
    if (tx.type === 'buy' && tx.quantity) {
      quantity += tx.quantity;
      totalCostCents += tx.amountCents;
    } else if (tx.type === 'sell' && tx.quantity) {
      if (quantity <= 0) continue;
      const soldFraction = tx.quantity / quantity;
      const costOfSoldUnits = BigInt(Math.round(Number(totalCostCents) * soldFraction));
      realizedPnlCents += tx.amountCents - costOfSoldUnits;
      totalCostCents -= costOfSoldUnits;
      quantity -= tx.quantity;
    }
  }

  const avgCostPerUnitCents = quantity > 0 ? totalCostCents / BigInt(quantity) : 0n;
  const marketValueCents = BigInt(quantity) * currentPriceCents;
  const unrealizedPnlCents = marketValueCents - totalCostCents;

  return {
    quantity,
    avgCostCents: avgCostPerUnitCents,
    marketValueCents,
    unrealizedPnlCents,
    realizedPnlCents,
  };
}
