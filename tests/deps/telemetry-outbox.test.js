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
    expect(outbox).not.toMatch(/'production_user'/);
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

  it('mark requires the current lease token, validates inputs, and dead-letters at max_attempts', () => {
    expect(outbox).toMatch(/WHERE id = p_id AND lease_token = p_lease_token FOR UPDATE/);
    expect(outbox).toMatch(/RAISE EXCEPTION 'invalid status/);
    expect(outbox).toMatch(/RAISE EXCEPTION 'invalid failure_category/);
    expect(outbox).toMatch(/v_attempts >= v_max/);
    expect(outbox).toMatch(/status='dead_letter'/);
    expect(outbox).toMatch(/telemetry_outbox_status_safe CHECK \(status IN \('pending', 'sending', 'sent', 'failed', 'dead_letter'\)\)/);
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
});
