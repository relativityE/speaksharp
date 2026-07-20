import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P0.4 authorization/isolation guard (static policy assertions). Runtime RLS is additionally proven
// post-deploy against the live DB; here we lock the policy SHAPE so a future migration can't silently
// widen access to the report store or the alert-delivery state.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIG = resolve(ROOT, 'backend/supabase/migrations');
const read = (f) => readFileSync(resolve(MIG, f), 'utf8');

const deliveries = read('20260720120000_report_alert_deliveries.sql');
// The user_issue_reports policies live across a few migrations; concatenate them.
const reportPolicies = readdirSync(MIG)
  .filter((f) => f.includes('user_issue_reports'))
  .map((f) => read(f))
  .join('\n');

describe('P0.4 — report alert delivery state is service-role-only', () => {
  it('report_alert_deliveries has RLS enabled', () => {
    expect(deliveries).toMatch(/ALTER TABLE public\.report_alert_deliveries ENABLE ROW LEVEL SECURITY/);
  });

  it('report_alert_deliveries defines NO row policies (only the service role may touch it)', () => {
    expect(deliveries).not.toMatch(/CREATE POLICY[^;]*ON public\.report_alert_deliveries/i);
  });

  it('report_alert_deliveries stores NO report prose or user identity columns', () => {
    // Only sanitized delivery-state columns are allowed.
    for (const forbidden of ['title', 'description', 'transcript', 'audio', 'user_id', 'email']) {
      expect(deliveries.toLowerCase()).not.toContain(`${forbidden} `);
    }
  });

  it('claim/mark helpers are service-role-only (revoked from public/anon/authenticated)', () => {
    expect(deliveries).toMatch(/REVOKE ALL ON FUNCTION public\.claim_report_alert\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(deliveries).toMatch(/REVOKE ALL ON FUNCTION public\.mark_report_alert\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  });

  it('the atomic dedupe claim is keyed on a unique report_id (PRIMARY KEY)', () => {
    expect(deliveries).toMatch(/report_id uuid PRIMARY KEY REFERENCES public\.user_issue_reports\(id\)/);
    expect(deliveries).toMatch(/ON CONFLICT \(report_id\) DO UPDATE/);
  });
});

describe('P0.4 — owner retrieval reuses the existing protected report RLS', () => {
  it('users may SELECT only their OWN reports (auth.uid() = user_id) — no cross-user read', () => {
    expect(reportPolicies).toMatch(/FOR SELECT\s+USING \(\(select auth\.uid\(\)\) = user_id\)/);
  });

  it('INSERT is scoped TO authenticated (not internet-spammable)', () => {
    expect(reportPolicies).toMatch(/FOR INSERT\s+TO authenticated/);
  });

  it('there is NO broad SELECT policy exposing all/anonymous reports to users (service-role only)', () => {
    // No policy granting SELECT with a permissive USING (true) or TO anon.
    expect(reportPolicies).not.toMatch(/FOR SELECT[^;]*USING \(true\)/i);
    expect(reportPolicies).not.toMatch(/FOR SELECT\s+TO anon/i);
  });
});
