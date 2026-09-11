-- ============================================================
-- CASHLY — SUPABASE SCHEMA & ROW LEVEL SECURITY (RLS)
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- ============================================================

-- 1. Create transactions table matching Cashly model
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- Ensure user_id column exists if table was already created earlier
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing permissive policies
DROP POLICY IF EXISTS "Allow public read access" ON public.transactions;
DROP POLICY IF EXISTS "Allow public insert access" ON public.transactions;
DROP POLICY IF EXISTS "Allow public update access" ON public.transactions;
DROP POLICY IF EXISTS "Allow public delete access" ON public.transactions;

DROP POLICY IF EXISTS "Users can select own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;

-- 4. User-Level RLS Policies (Users can only access their own transactions)
CREATE POLICY "Users can select own transactions"
ON public.transactions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
ON public.transactions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
ON public.transactions
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 5. Indexes for fast user queries and ordering
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions (transaction_date DESC, created_at DESC);

-- NOTE: If your Supabase project requires email confirmation for Sign In,
-- you can auto-confirm emails in development by running:
-- UPDATE auth.users SET email_confirmed_at = NOW() WHERE email_confirmed_at IS NULL;
