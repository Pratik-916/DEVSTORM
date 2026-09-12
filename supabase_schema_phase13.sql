-- ============================================================
-- CASHLY PHASE 13: BUSINESS GOALS & BUDGETS SCHEMA
-- ============================================================
-- Adds tables, indexes, and RLS policies for:
--  1. public.business_goals (cash_target, savings_target, sales_target, expense_limit)
--  2. public.budgets (weekly, monthly, custom category spending limits)
-- ============================================================

-- 1. BUSINESS GOALS TABLE
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

-- 2. BUDGETS TABLE
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

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_business_goals_business_id ON public.business_goals (business_id);
CREATE INDEX IF NOT EXISTS idx_business_goals_status ON public.business_goals (business_id, status);
CREATE INDEX IF NOT EXISTS idx_budgets_business_id ON public.budgets (business_id);
CREATE INDEX IF NOT EXISTS idx_budgets_status ON public.budgets (business_id, status);

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.business_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can manage business goals" ON public.business_goals;
CREATE POLICY "Owners can manage business goals"
ON public.business_goals
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Owners can manage budgets" ON public.budgets;
CREATE POLICY "Owners can manage budgets"
ON public.budgets
FOR ALL
TO authenticated
USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()))
WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));
