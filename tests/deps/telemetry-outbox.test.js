import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P0 (incident) foundation guard — SQL-shape guards (lightweight). Behavioral proofs live in the
// migration-backed DB tests; these lock structural invariants so a future migration can't regress
// dedupe, RLS, service-role restriction, leases, dead-letter, or the legacy_unclassified default.
const MIG = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/supabase/migrations');
const registry = readFileSync(resolve(MIG, '20260720150000_observability_provenance_registry.sql'), 'utf8');
const outbox = readFileSync(resolve(MIG, '20260720150100_telemetry_outbox.sql'), 'utf8');

describe('P0 — provenance registry', () => {
  it('keyed by user_id, RLS service-role-only, explicit grants to service_role', () => {
    expect(registry).toMatch(/user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\)/);
    expect(registry).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(registry).not.toMatch(/CREATE POLICY[^;]*observability_actor_registry/i);
    expect(registry).toMatch(/GRANT ALL ON TABLE public\.observability_actor_registry TO service_role/);
  });

  it('UNKNOWN/expired/unresolved actors resolve to legacy_unclassified — NOT production_user', () => {
    // both resolvers must default to legacy_unclassified
    expect((registry.match(/'legacy_unclassified'\s*\n?\s*\)/g) || registry.match(/'legacy_unclassified'/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(registry).not.toMatch(/COALESCE\([^)]*'production_user'\s*\)/); // no production_user fallback
  });

  it('resolvers are service-role-only (revoked from anon/authenticated, granted to service_role)', () => {
    for (const fn of ['resolve_data_origin', 'resolve_actor_provenance']) {
      expect(registry).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
      expect(registry).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`));
    }
  });

  it('resolve_actor_provenance returns ALL FOUR marker fields (not just data_origin)', () => {
    expect(registry).toMatch(/RETURNS TABLE \(data_origin text, cohort_id text, test_run_id text, test_suite text\)/);
  });

  it('every SECURITY DEFINER fn pins a trusted search_path (pg_catalog first)', () => {
    const definerBodies = registry.split(/CREATE OR REPLACE FUNCTION/).slice(1).filter((c) => /SECURITY DEFINER/.test(c));
    expect(definerBodies.length).toBeGreaterThanOrEqual(2);
    for (const chunk of definerBodies) expect(chunk).toMatch(/SET search_path = pg_catalog, public/);
  });
});

describe('P0 — telemetry outbox (corrected)', () => {
  it('RLS service-role-only + explicit grants; no prose/PII columns', () => {
    expect(outbox).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(outbox).not.toMatch(/CREATE POLICY[^;]*telemetry_outbox/i);
    expect(outbox).toMatch(/REVOKE ALL ON TABLE public\.telemetry_outbox FROM PUBLIC, anon, authenticated/);
    expect(outbox).toMatch(/GRANT ALL ON TABLE public\.telemetry_outbox TO service_role/);
    // no content-bearing COLUMN definitions (comment mentions are fine)
    expect(outbox).not.toMatch(/\n\s+(title|description|transcript|transcript_excerpt|audio_attachment_note|email)\s+(text|jsonb|boolean)/i);
  });

  it('stable insert_id + UNIQUE(event_type, record_id) dedupe', () => {
    expect(outbox).toMatch(/CONSTRAINT telemetry_outbox_dedupe UNIQUE \(event_type, record_id\)/);
    expect(outbox).toMatch(/p_event_type \|\| ':' \|\| p_record_id::text/);
    expect(outbox).toMatch(/ON CONFLICT \(event_type, record_id\) DO NOTHING/);
  });

  it('unknown actor defaults to legacy_unclassified (server-assigned, not client)', () => {
    expect(outbox).toMatch(/data_origin text NOT NULL DEFAULT 'legacy_unclassified'/);
    expect(outbox).toMatch(/COALESCE\(v_prov\.data_origin, 'legacy_unclassified'\)/);
  });

  it('data_origin is CHECK-constrained to the registry vocabulary', () => {
    expect(outbox).toMatch(/CONSTRAINT telemetry_outbox_data_origin_safe CHECK/);
    for (const v of ['automated_test', 'beta_tester', 'production_user', 'synthetic_monitor', 'legacy_unclassified']) {
      expect(outbox).toMatch(new RegExp(`'${v}'`));
    }
  });

  it('retry invariants: attempt_count>=0, max_attempts 1..20, terminal_failed_at iff dead_letter', () => {
    expect(outbox).toMatch(/CONSTRAINT telemetry_outbox_attempts_nonneg CHECK \(attempt_count >= 0\)/);
    expect(outbox).toMatch(/CONSTRAINT telemetry_outbox_max_attempts_range CHECK \(max_attempts BETWEEN 1 AND 20\)/);
    expect(outbox).toMatch(/status = 'dead_letter' AND terminal_failed_at IS NOT NULL/);
    expect(outbox).toMatch(/status <> 'dead_letter' AND terminal_failed_at IS NULL/);
  });

  it('enqueue + reconcile populate ALL FOUR provenance fields via resolve_actor_provenance', () => {
    // enqueue resolves provenance then writes all four columns
    expect(outbox).toMatch(/SELECT \* INTO v_prov FROM public\.resolve_actor_provenance\(p_user_id\)/);
    expect(outbox).toMatch(/data_origin, cohort_id, test_run_id, test_suite/);
    // reconcile joins the resolver and selects all four (not just data_origin)
    expect(outbox).toMatch(/CROSS JOIN LATERAL public\.resolve_actor_provenance\(s\.user_id\) p/);
    expect(outbox).toMatch(/CROSS JOIN LATERAL public\.resolve_actor_provenance\(r\.user_id\) p/);
    expect(outbox).toMatch(/p\.data_origin, p\.cohort_id, p\.test_run_id, p\.test_suite/);
  });

  it('session_saved event_timestamp = completion time COALESCE(updated_at, created_at); reports use created_at', () => {
    expect(outbox).toMatch(/COALESCE\(NEW\.updated_at, NEW\.created_at\)/); // trigger
    expect(outbox).toMatch(/COALESCE\(s\.updated_at, s\.created_at\)/); // reconcile
  });

  it('reports recover UNTRUSTED client SHA from metadata; sessions never fabricate a client SHA', () => {
    expect(outbox).toMatch(/NULLIF\(NEW\.metadata->'appRuntimeConfig'->>'release', ''\)/); // report trigger
    expect(outbox).toMatch(/NULLIF\(r\.metadata->'appRuntimeConfig'->>'release', ''\)/); // reconcile reports
    // session enqueue/reconcile pass NULL for client SHA (no authoritative source)
    expect(outbox).toMatch(/'session_saved', NEW\.id, NEW\.user_id,\s*\n\s*COALESCE\(NEW\.updated_at, NEW\.created_at\), NULL\)/);
  });

  it('splits client vs server-verified release SHA (never presents client SHA as verified)', () => {
    expect(outbox).toMatch(/client_release_sha text/);
    expect(outbox).toMatch(/server_verified_release_sha text/);
  });

  it('enqueue triggers are EXCEPTION-guarded AND an authoritative reconcile() repairs gaps', () => {
    expect(outbox).toMatch(/AFTER INSERT ON public\.user_issue_reports/);
    expect(outbox).toMatch(/AFTER INSERT OR UPDATE OF status ON public\.sessions/);
    expect((outbox.match(/EXCEPTION WHEN OTHERS THEN NULL/g) || []).length).toBeGreaterThanOrEqual(2);
    // the guarantee: reconcile scans authoritative sessions + reports for missing outbox rows
    expect(outbox).toMatch(/FUNCTION public\.reconcile_telemetry_outbox/);
    expect(outbox).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.telemetry_outbox o WHERE o\.event_type='session_saved'/);
    expect(outbox).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.telemetry_outbox o WHERE o\.event_type='report_issue_submitted'/);
  });

  it('claim is crash-safe: clamps limit, leases with token + expiry, reclaims expired sending', () => {
    expect(outbox).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 200\)/);
    expect(outbox).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(outbox).toMatch(/lease_token = gen_random_uuid\(\)/);
    expect(outbox).toMatch(/status = 'sending' AND o\.lease_expires_at IS NOT NULL AND o\.lease_expires_at < now\(\)/);
  });

  it('mark requires an unexpired lease on a sending row, validates inputs, dead-letters at max_attempts', () => {
    // ownership = current, unexpired lease on a row still 'sending'
    expect(outbox).toMatch(/WHERE id = p_id AND status = 'sending' AND lease_token = p_lease_token AND lease_expires_at > now\(\)/);
    expect(outbox).toMatch(/RAISE EXCEPTION 'invalid status/);
    expect(outbox).toMatch(/'sent must not carry a failure_category'/);
    expect(outbox).toMatch(/'failed requires an allowed failure_category/);
    expect(outbox).toMatch(/v_attempts >= v_max/);
    expect(outbox).toMatch(/status='dead_letter'/);
    expect(outbox).toMatch(/telemetry_outbox_status_safe CHECK \(status IN \('pending', 'sending', 'sent', 'failed', 'dead_letter'\)\)/);
  });

  it('every state transition (sent/failed/dead_letter) clears ALL lease fields incl claimed_by', () => {
    // three UPDATE branches in mark + the replay reset must each null token, expiry, and claimed_by
    const clears = outbox.match(/lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL/g) || [];
    expect(clears.length).toBeGreaterThanOrEqual(4);
  });

  it('has an explicit operator replay for dead_letter', () => {
    expect(outbox).toMatch(/FUNCTION public\.replay_telemetry_deadletter/);
    expect(outbox).toMatch(/WHERE id=p_id AND status='dead_letter'/);
  });

  it('every worker RPC is service-role-only (revoked + granted)', () => {
    for (const fn of ['enqueue_telemetry_event', 'reconcile_telemetry_outbox', 'claim_telemetry_batch', 'mark_telemetry_result', 'replay_telemetry_deadletter']) {
      expect(outbox).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`));
      expect(outbox).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`));
    }
  });

  it('documents $insert_id (dollar-prefixed) as the PostHog dedupe property for the worker', () => {
    expect(outbox).toMatch(/\$insert_id/);
  });

  it('every SECURITY DEFINER fn pins a trusted search_path (pg_catalog first)', () => {
    const definerBodies = outbox.split(/CREATE OR REPLACE FUNCTION/).slice(1).filter((c) => /SECURITY DEFINER/.test(c));
    expect(definerBodies.length).toBeGreaterThanOrEqual(5);
    for (const chunk of definerBodies) expect(chunk).toMatch(/SET search_path = pg_catalog, public/);
  });
});
