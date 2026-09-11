-- ============================================================
-- CASHLY — CONSOLIDATED PRODUCTION SUPABASE DATABASE SCHEMA
-- Core PostgreSQL Tables, Foreign Keys, Performance Indexes & RLS Setup
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- Safe to run more than once (uses IF NOT EXISTS / DROP IF EXISTS)
-- ============================================================

-- 1. BUSINESSES TABLE
-- Represents merchant businesses owned by an authenticated user.
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TRANSACTIONS TABLE
-- Core cashflow ledger for sales, expenses, and withdrawals.
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
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

-- If transactions table already exists, ensure required columns exist
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. FINANCIAL ACCOUNTS TABLE
-- Tracks connected banking, UPI, and digital merchant accounts for a business.
CREATE TABLE IF NOT EXISTS public.financial_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'syncing', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. UPCOMING OBLIGATIONS TABLE
-- Tracks scheduled vendor payments, rent, payroll, and upcoming liabilities.
CREATE TABLE IF NOT EXISTS public.upcoming_obligations (
    id TEXT PRIMARY KEY,
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'overdue')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. ALERTS TABLE
-- Stores proactive cashflow warnings & notifications linked to business, protected by RLS.
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'caution' CHECK (severity IN ('risk', 'caution', 'healthy')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_businesses_owner_id ON public.businesses (owner_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business_id ON public.transactions (business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions (transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_accounts_business_id ON public.financial_accounts (business_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_obligations_business_id ON public.upcoming_obligations (business_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_obligations_due_date ON public.upcoming_obligations (due_date ASC);
CREATE INDEX IF NOT EXISTS idx_alerts_business_id ON public.alerts (business_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON public.alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_business_unread ON public.alerts (business_id, is_read, created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) PREPARATION & POLICIES
-- ============================================================
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upcoming_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- 1. Businesses Policies
DROP POLICY IF EXISTS "Owners can manage own businesses" ON public.businesses;
CREATE POLICY "Owners can manage own businesses"
ON public.businesses
FOR ALL
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- 2. Transactions Policies (supports business_id ownership with user_id fallback)
DROP POLICY IF EXISTS "Users can select own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;

CREATE POLICY "Users can select own transactions"
ON public.transactions
FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id 
    OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);

CREATE POLICY "Users can insert own transactions"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id 
    OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);

CREATE POLICY "Users can update own transactions"
ON public.transactions
FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id 
    OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
)
WITH CHECK (
    auth.uid() = user_id 
    OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);

CREATE POLICY "Users can delete own transactions"
ON public.transactions
FOR DELETE
TO authenticated
USING (
    auth.uid() = user_id 
    OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);

-- 3. Financial Accounts Policies
DROP POLICY IF EXISTS "Owners can manage financial accounts" ON public.financial_accounts;
CREATE POLICY "Owners can manage financial accounts"
ON public.financial_accounts
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- 4. Upcoming Obligations Policies
DROP POLICY IF EXISTS "Owners can manage upcoming obligations" ON public.upcoming_obligations;
CREATE POLICY "Owners can manage upcoming obligations"
ON public.upcoming_obligations
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- 5. Alerts Policies
DROP POLICY IF EXISTS "Owners can manage own alerts" ON public.alerts;
CREATE POLICY "Owners can manage own alerts"
ON public.alerts
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));
