import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #1282 — the 30-day full-product trial -> $10/month lifecycle. Static-analysis contract over the
// slice-1 entitlement-foundation migration (mirrors tests/release/free-tier-db-contract.test.ts style:
// assert the committed migration text, so the durable commercial contract cannot silently regress).
const readMigration = (name: string) =>
    readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', name), 'utf8');

describe('#1282 30-day trial lifecycle — entitlement foundation', () => {
    const migration = readMigration('20260812000000_thirty_day_trial_lifecycle_1282.sql');

    it('grants full product for a LIVE trial window while preserving the paid-Pro invariant', () => {
        // Live (unexpired) trial -> pro.
        expect(migration).toMatch(/p_trial_expires_at IS NOT NULL AND p_trial_expires_at > now\(\)\s*\n\s*THEN 'pro'/);
        // Paid Pro STILL requires status=pro AND a real stripe_subscription_id (unchanged invariant).
        expect(migration).toMatch(/lower\(COALESCE\(p_subscription_status, 'free'\)\) = 'pro'\s*\n\s*AND NULLIF\(trim\(COALESCE\(p_stripe_subscription_id, ''\)\), ''\) IS NOT NULL\s*\n\s*THEN 'pro'/);
        // Everything else is free.
        expect(migration).toMatch(/ELSE 'free'/);
    });

    it('stamps a 30-day full-product window on a new account', () => {
        expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.ensure_trial_profile_for_new_user/);
        expect(migration).toMatch(/now\(\)\s*\+\s*interval '30 days'/);
        // New account is 'free' subscription_status with a live trial window (not paid).
        expect(migration).toMatch(/NEW\.id,\s*\n\s*'free',/);
        // Idempotent: never shorten/backdate an existing live window.
        expect(migration).toMatch(/trial_started_at = COALESCE\(public\.user_profiles\.trial_started_at, EXCLUDED\.trial_started_at\)/);
        expect(migration).toMatch(/trial_expires_at = COALESCE\(public\.user_profiles\.trial_expires_at, EXCLUDED\.trial_expires_at\)/);
    });

    it('re-applies the 20260811 hardening for the replaced trigger function', () => {
        expect(migration).toMatch(/SET search_path = public, pg_temp/);
        expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.ensure_trial_profile_for_new_user\(\) FROM PUBLIC, anon, authenticated, service_role/);
    });

    it('one-time activation stamp is non-retroactive, paid-safe, and idempotent', () => {
        // Only accounts with NO live window are (re)stamped.
        expect(migration).toMatch(/WHERE \(trial_expires_at IS NULL OR trial_expires_at <= now\(\)\)/);
        // Paid accounts are never touched by the stamp.
        expect(migration).toMatch(/AND NOT \(\s*\n\s*lower\(COALESCE\(subscription_status, 'free'\)\) = 'pro'\s*\n\s*AND NULLIF\(trim\(COALESCE\(stripe_subscription_id, ''\)\), ''\) IS NOT NULL\s*\n\s*\)/);
        // The stamp starts NOW (non-retroactive) for a fresh 30 days.
        expect(migration).toMatch(/SET trial_started_at = now\(\),\s*\n\s*trial_expires_at = now\(\) \+ interval '30 days'/);
    });

    it('restores a 30-day default on both trial-window columns', () => {
        expect(migration).toMatch(/ALTER TABLE public\.user_profiles\s*\n\s*ALTER COLUMN trial_expires_at SET DEFAULT \(now\(\) \+ interval '30 days'\)/);
        expect(migration).toMatch(/ALTER TABLE public\.trial_entitlements\s*\n\s*ALTER COLUMN trial_expires_at SET DEFAULT \(now\(\) \+ interval '30 days'\)/);
    });

    it('does not create a Stripe price/checkout or flip payment enablement on apply', () => {
        // Reading the stripe_subscription_id COLUMN (the paid invariant) is expected; what must NOT appear
        // is any price/checkout creation or a payments-enablement flip inside an entitlement migration.
        expect(migration).not.toMatch(/PAYMENTS_ENABLED|STRIPE_PRO_PRICE_ID|checkout\.sessions|prices\.(create|retrieve)|unit_amount/i);
    });
});

describe('#1282 30-day trial lifecycle — expired state fails closed (slice 2)', () => {
    const enforcement = readMigration('20260812001000_trial_expiry_fail_closed_1282.sql');

    it('refuses new recording for non-pro (expired/unpaid) in the write path', () => {
        expect(enforcement).toMatch(/CREATE OR REPLACE FUNCTION public\.update_user_usage/);
        expect(enforcement).toMatch(/IF COALESCE\(v_effective_tier, 'free'\) <> 'pro' THEN\s*\n\s*RETURN jsonb_build_object\(\s*\n\s*'success', false,\s*\n\s*'error', 'trial_expired'/);
    });

    it('refuses can_start for non-pro in the pre-flight and reports trial_expired', () => {
        expect(enforcement).toMatch(/CREATE OR REPLACE FUNCTION public\.check_usage_limit/);
        expect(enforcement).toMatch(/'can_start', false,[\s\S]*'error', 'trial_expired'/);
    });

    it('retires the 300s private-sample fallback (no sample grant remains in the gates)', () => {
        // The gates must not grant or track a private-sample allowance any more.
        expect(enforcement).not.toMatch(/private_sample_limit_reached|private_sample_used|private_sample_session_required/);
        expect(enforcement).not.toMatch(/v_sample_remaining|v_new_sample_used/);
        // private_sample_available is always false now.
        expect(enforcement).not.toMatch(/'private_sample_available', \(/);
        expect(enforcement).toMatch(/'private_sample_available', false/);
    });

    it('surfaces a real live-trial countdown (not hardcoded false) for the UI', () => {
        expect(enforcement).toMatch(/v_trial_active := \(v_effective_tier = 'pro' AND NOT v_is_paid/);
        expect(enforcement).toMatch(/'trial_active', v_trial_active/);
        expect(enforcement).toMatch(/'trial_seconds_remaining', CASE\s*\n\s*WHEN v_trial_active THEN GREATEST\(0, EXTRACT\(EPOCH FROM \(v_trial_expires_at - now\(\)\)\)::INT\)/);
    });

    it('keeps the paid invariant when computing paid-vs-trial (real Stripe sub required for paid)', () => {
        expect(enforcement).toMatch(/lower\(COALESCE\(subscription_status, 'free'\)\) = 'pro'\s*\n\s*AND NULLIF\(trim\(COALESCE\(stripe_subscription_id, ''\)\), ''\) IS NOT NULL\)/);
    });
});
