-- Portfolio Manager — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- It creates the tables and Row Level Security so each user only ever sees and
-- edits their own rows (enforced by the database, not the client).

-- ── Transactions ────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  row_hash    text not null,                 -- de-dup key across re-imports
  date        timestamptz not null,
  type        text not null,                 -- buy | sell | dividend | deposit | withdrawal | fee
  ticker      text,
  quantity    double precision,
  price       double precision,
  currency    text not null,                 -- ARS | USD
  amount_cents text not null,                -- stored as text to preserve exact BigInt cents
  raw_row     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, row_hash)
);

-- ── Current prices (one per ticker per user) ────────────────────────────────
create table if not exists public.prices (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker      text not null,
  price_cents text not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, ticker)
);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.transactions enable row level security;
alter table public.prices       enable row level security;

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own prices" on public.prices;
create policy "own prices" on public.prices
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
