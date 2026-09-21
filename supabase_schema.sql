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

-- Phase 9: Provider metadata columns for real financial provider & Account Aggregator readiness
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS provider TEXT,
ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT;

-- Phase 28: Data Quality & Reconciliation Hardening
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS provider_sync_hash TEXT,
ADD COLUMN IF NOT EXISTS reconciliation_status TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Phase 29: Reconciliation Review & Resolution
-- Stores the pending provider correction for transactions requiring merchant review.
-- Financial engines (CashflowEngine, StatementEngine, etc.) read only the top-level
-- columns (amount, type, date) and naturally ignore this JSONB payload, guaranteeing
-- financial invariance while the review is pending.
-- pending_correction is null when no review is pending.
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS pending_correction JSONB;

-- Index to efficiently find all transactions with a pending review for a business.
-- Used by the review banner to display unresolved review count.
CREATE INDEX IF NOT EXISTS idx_transactions_pending_correction
ON public.transactions (business_id)
WHERE pending_correction IS NOT NULL;

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

-- Phase 9: Financial account provider metadata for connection lifecycle & external ID mapping
ALTER TABLE public.financial_accounts
ADD COLUMN IF NOT EXISTS external_account_id TEXT,
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'DISCONNECTED',
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

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

-- 6. BUSINESS GOALS TABLE (Phase 13)
-- Tracks cash targets, savings reserves, sales quotas, and expense caps.
CREATE TABLE IF NOT EXISTS public.business_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    goal_type TEXT NOT NULL CHECK (goal_type IN ('cash_target', 'savings_target', 'sales_target', 'expense_limit')),
    target_amount NUMERIC NOT NULL CHECK (target_amount > 0),
    target_date DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. BUDGETS TABLE (Phase 13)
-- Tracks category-based spending allocations and operational cost limits.
CREATE TABLE IF NOT EXISTS public.budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly', 'custom')),
    start_date DATE,
    end_date DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. ACTION TASKS TABLE (Phase 25)
-- Tracks merchant task execution, lifecycle statuses, and operational notes.
CREATE TABLE IF NOT EXISTS public.action_tasks (
    id TEXT PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    action_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED')),
    notes TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_transactions_provider_tx ON public.transactions (provider, provider_account_id, provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_business_goals_business_id ON public.business_goals (business_id);
CREATE INDEX IF NOT EXISTS idx_business_goals_status ON public.business_goals (business_id, status);
CREATE INDEX IF NOT EXISTS idx_budgets_business_id ON public.budgets (business_id);
CREATE INDEX IF NOT EXISTS idx_budgets_status ON public.budgets (business_id, status);
CREATE INDEX IF NOT EXISTS idx_action_tasks_business_id ON public.action_tasks (business_id);
CREATE INDEX IF NOT EXISTS idx_action_tasks_status ON public.action_tasks (business_id, status);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) PREPARATION & POLICIES
-- ============================================================
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upcoming_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_tasks ENABLE ROW LEVEL SECURITY;

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
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);

CREATE POLICY "Users can insert own transactions"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);

CREATE POLICY "Users can update own transactions"
ON public.transactions
FOR UPDATE
TO authenticated
USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
)
WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);

CREATE POLICY "Users can delete own transactions"
ON public.transactions
FOR DELETE
TO authenticated
USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
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

-- 6. Business Goals Policies (Phase 13)
DROP POLICY IF EXISTS "Owners can manage business goals" ON public.business_goals;
CREATE POLICY "Owners can manage business goals"
ON public.business_goals
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- 7. Budgets Policies (Phase 13)
DROP POLICY IF EXISTS "Owners can manage budgets" ON public.budgets;
CREATE POLICY "Owners can manage budgets"
ON public.budgets
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- 8. Action Tasks Policies (Phase 25)
DROP POLICY IF EXISTS "Owners can manage action tasks" ON public.action_tasks;
CREATE POLICY "Owners can manage action tasks"
ON public.action_tasks
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- ============================================================
-- PHASE 27: REAL FINANCIAL ACCOUNT INTEGRATION FOUNDATION
-- Schema migration — extends financial_accounts with fields
-- required for the production provider architecture.
--
-- CANONICAL ACCOUNT ID MODEL:
--   provider_account_id = Phase 27 canonical provider-owned identifier
--     (e.g. the unique ID the bank/UPI/AA assigns to this account)
--   external_account_id = Phase 9 legacy field — preserved for backward
--     compatibility. Existing rows keep their external_account_id values.
--
-- Safe to run more than once (ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- 9. FINANCIAL ACCOUNTS — Phase 27 extended fields

-- Human-readable name of the institution (e.g. "HDFC Bank", "Axis Bank")
ALTER TABLE public.financial_accounts
ADD COLUMN IF NOT EXISTS institution_name TEXT;

-- Structured account classification separate from the generic 'type' column.
-- Values: Bank, UPI, Card, Cash, Credit, Wallet
-- The existing 'type' column is kept as-is for backward compatibility.
ALTER TABLE public.financial_accounts
ADD COLUMN IF NOT EXISTS account_type TEXT;

-- ISO 4217 currency code. Defaults to INR for all existing Cashly businesses.
ALTER TABLE public.financial_accounts
ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';

-- Opaque provider-specific extras (e.g. routing number, IFSC).
-- MUST NOT contain credentials, tokens, or secrets.
ALTER TABLE public.financial_accounts
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Phase 27 canonical provider account identifier.
-- This is the stable, provider-assigned ID for this account.
-- external_account_id (Phase 9) is preserved for backward compatibility.
ALTER TABLE public.financial_accounts
ADD COLUMN IF NOT EXISTS provider_account_id TEXT;

-- Audit column: tracks when the account record was last modified.
ALTER TABLE public.financial_accounts
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Normalize any existing legacy lowercase connection_status values safely
UPDATE public.financial_accounts
SET connection_status = UPPER(connection_status)
WHERE connection_status IS NOT NULL AND connection_status != UPPER(connection_status);

-- Database-level CHECK constraint for connection_status lifecycle states.
-- Supported lifecycle states:
--   DISCONNECTED, CONNECTING, CONSENT_REQUIRED, CONNECTED,
--   SYNCING, ERROR, CONNECT_FAILED, SYNC_FAILED
-- Note: 'ERROR' and 'CONSENT_REQUIRED' are preserved for Phase 9 legacy row compatibility.
ALTER TABLE public.financial_accounts
DROP CONSTRAINT IF EXISTS chk_financial_accounts_connection_status;

ALTER TABLE public.financial_accounts
ADD CONSTRAINT chk_financial_accounts_connection_status
CHECK (connection_status IN (
    'DISCONNECTED',
    'CONNECTING',
    'CONSENT_REQUIRED',
    'CONNECTED',
    'SYNCING',
    'ERROR',
    'CONNECT_FAILED',
    'SYNC_FAILED'
));

-- Phase 27 Performance Indexes

-- Provider/account lookup for idempotency and duplicate prevention
CREATE INDEX IF NOT EXISTS idx_financial_accounts_provider_account_id
ON public.financial_accounts (business_id, provider_account_id);

-- Quick lookup of connected accounts for a business
CREATE INDEX IF NOT EXISTS idx_financial_accounts_connection_status
ON public.financial_accounts (business_id, connection_status);

-- ============================================================
-- PHASE 31: SECURE BUSINESS CREATION FUNCTION
-- ============================================================
-- Prevents clients from assigning arbitrary owner_ids or generating UUIDs.
CREATE OR REPLACE FUNCTION public.get_or_create_business(default_name TEXT)
RETURNS SETOF public.businesses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business public.businesses;
    v_uid UUID;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Try to fetch existing
    SELECT * INTO v_business FROM public.businesses WHERE owner_id = v_uid LIMIT 1;
    
    -- If it doesn't exist, create it safely
    IF NOT FOUND THEN
        INSERT INTO public.businesses (owner_id, name)
        VALUES (v_uid, COALESCE(default_name, 'My Business'))
        RETURNING * INTO v_business;
    END IF;

    RETURN NEXT v_business;
END;
$$;
