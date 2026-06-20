// Cloud data layer backed by Supabase. Every query is implicitly scoped to the
// logged-in user by Row Level Security, so we never filter by user_id here.
import { supabase } from './supabaseClient';
import { txKey, type ParsedTransaction } from './portfolio';

interface TxRow {
  date: string;
  type: ParsedTransaction['type'];
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  currency: ParsedTransaction['currency'];
  amount_cents: string;
  raw_row: Record<string, string>;
}

function rowToTx(r: TxRow): ParsedTransaction {
  return {
    date: new Date(r.date),
    type: r.type,
    ticker: r.ticker,
    quantity: r.quantity,
    price: r.price,
    currency: r.currency,
    amountCents: BigInt(r.amount_cents),
    rawRow: r.raw_row ?? {},
  };
}

export async function fetchTransactions(): Promise<ParsedTransaction[]> {
  const { data, error } = await supabase!
    .from('transactions')
    .select('date,type,ticker,quantity,price,currency,amount_cents,raw_row')
    .order('date', { ascending: true });
  if (error) throw error;
  return (data as TxRow[] | null ?? []).map(rowToTx);
}

/** Inserts only transactions not already present (dedup by row_hash). Returns
 *  the number of new rows actually added. */
export async function insertTransactions(
  incoming: ParsedTransaction[],
  existing: ParsedTransaction[],
): Promise<number> {
  const known = new Set(existing.map(txKey));
  const fresh = incoming.filter((t) => !known.has(txKey(t)));
  if (fresh.length === 0) return 0;
  const rows = fresh.map((t) => ({
    row_hash: txKey(t),
    date: t.date.toISOString(),
    type: t.type,
    ticker: t.ticker,
    quantity: t.quantity,
    price: t.price,
    currency: t.currency,
    amount_cents: t.amountCents.toString(),
    raw_row: t.rawRow ?? {},
  }));
  const { error } = await supabase!.from('transactions').insert(rows);
  if (error) throw error;
  return fresh.length;
}

export async function fetchPrices(): Promise<Record<string, bigint>> {
  const { data, error } = await supabase!.from('prices').select('ticker,price_cents');
  if (error) throw error;
  const out: Record<string, bigint> = {};
  for (const r of (data as { ticker: string; price_cents: string }[] | null) ?? []) {
    out[r.ticker] = BigInt(r.price_cents);
  }
  return out;
}

export async function upsertPrices(prices: Record<string, bigint>): Promise<void> {
  const rows = Object.entries(prices).map(([ticker, cents]) => ({
    ticker,
    price_cents: cents.toString(),
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await supabase!.from('prices').upsert(rows, { onConflict: 'user_id,ticker' });
  if (error) throw error;
}

export async function deleteAllData(): Promise<void> {
  const t = await supabase!.from('transactions').delete().not('id', 'is', null);
  if (t.error) throw t.error;
  const p = await supabase!.from('prices').delete().not('ticker', 'is', null);
  if (p.error) throw p.error;
}
