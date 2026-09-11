-- ============================================================
-- CASHLY — SUPABASE SCHEMA
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- ============================================================

-- Create transactions table matching Cashly model
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('sale', 'expense', 'withdrawal')),
    amount NUMERIC NOT NULL DEFAULT 0,
    source TEXT NOT NULL CHECK (source IN ('manual', 'auto')),
    payment_method TEXT NOT NULL,
    settlement_status TEXT NOT NULL CHECK (settlement_status IN ('settled', 'pending')),
    category TEXT,
    channel TEXT,
    reference TEXT,
    description TEXT,
    transaction_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Allow public access for Cashly demo app (no auth required)
DROP POLICY IF EXISTS "Allow public read access" ON public.transactions;
CREATE POLICY "Allow public read access"
ON public.transactions
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow public insert access" ON public.transactions;
CREATE POLICY "Allow public insert access"
ON public.transactions
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access" ON public.transactions;
CREATE POLICY "Allow public update access"
ON public.transactions
FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete access" ON public.transactions;
CREATE POLICY "Allow public delete access"
ON public.transactions
FOR DELETE
USING (true);

-- Index for speedy ordering by date
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions (transaction_date DESC, created_at DESC);
