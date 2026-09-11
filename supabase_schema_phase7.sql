-- ============================================================
-- CASHLY — SUPABASE SCHEMA PHASE 7: ALERTS / NOTIFICATIONS
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- Safe to run more than once (uses IF NOT EXISTS / DROP IF EXISTS)
-- ============================================================

-- 1. ALERTS TABLE
-- Stores cashflow alerts linked to a business, protected by RLS.
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL,          -- e.g. 'low_safe_to_spend', 'obligation_due_soon'
    severity TEXT NOT NULL DEFAULT 'caution'
        CHECK (severity IN ('risk', 'caution', 'healthy')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_alerts_business_id
    ON public.alerts (business_id);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at
    ON public.alerts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_business_unread
    ON public.alerts (business_id, is_read, created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Only allow authenticated users to access alerts belonging to their own business
DROP POLICY IF EXISTS "Owners can manage own alerts" ON public.alerts;
CREATE POLICY "Owners can manage own alerts"
ON public.alerts
FOR ALL
TO authenticated
USING (
    business_id IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
)
WITH CHECK (
    business_id IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
);
