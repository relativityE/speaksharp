import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P0 (incident) foundation guard: lock the durable-outbox + provenance-registry shape so a future
// migration can't weaken dedupe, RLS, service-role restriction, or the non-blocking enqueue.
const MIG = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/supabase/migrations');
const registry = readFileSync(resolve(MIG, '20260720150000_observability_provenance_registry.sql'), 'utf8');
const outbox = readFileSync(resolve(MIG, '20260720150100_telemetry_outbox.sql'), 'utf8');

describe('P0 — server-assigned provenance registry', () => {
  it('is keyed by authenticated user_id and RLS-enabled service-role-only', () => {
    expect(registry).toMatch(/user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\)/);
    expect(registry).toMatch(/ALTER TABLE public\.observability_actor_registry ENABLE ROW LEVEL SECURITY/);
    expect(registry).not.toMatch(/CREATE POLICY[^;]*observability_actor_registry/i);
  });

  it('constrains data_origin to the allowed classifications', () => {
    for (const v of ['automated_test', 'seed_fixture', 'owner_manual_test', 'beta_tester', 'production_user', 'synthetic_monitor', 'legacy_unclassified']) {
      expect(registry).toContain(`'${v}'`);
    }
  });

  it('resolve helpers are service-role-only (a client cannot probe/spoof provenance)', () => {
    expect(registry).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_data_origin\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(registry).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_actor_provenance\(uuid\) FROM PUBLIC, anon, authenticated/);
  });
});

describe('P0 — durable telemetry outbox', () => {
  it('is RLS-enabled with NO policies (service-role/worker only) and carries no prose/PII columns', () => {
    expect(outbox).toMatch(/ALTER TABLE public\.telemetry_outbox ENABLE ROW LEVEL SECURITY/);
    expect(outbox).not.toMatch(/CREATE POLICY[^;]*telemetry_outbox/i);
    for (const forbidden of ['title', 'description', 'transcript', 'audio', 'email']) {
      expect(outbox.toLowerCase()).not.toContain(`${forbidden} text`);
    }
  });

  it('dedupes by (event_type, record_id) with a stable insert_id', () => {
    expect(outbox).toMatch(/CONSTRAINT telemetry_outbox_dedupe UNIQUE \(event_type, record_id\)/);
    expect(outbox).toMatch(/p_event_type \|\| ':' \|\| p_record_id::text/);
    expect(outbox).toMatch(/ON CONFLICT \(event_type, record_id\) DO NOTHING/);
  });

  it('enqueues on the persistence boundary and NEVER rolls back persistence (EXCEPTION guard)', () => {
    expect(outbox).toMatch(/AFTER INSERT ON public\.user_issue_reports/);
    expect(outbox).toMatch(/AFTER INSERT OR UPDATE OF status ON public\.sessions/);
    expect(outbox).toMatch(/NEW\.status = 'completed'/);
    // both enqueue triggers must swallow errors so the primary insert survives
    expect((outbox.match(/EXCEPTION WHEN OTHERS THEN\s+NULL/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('derives provenance from the registry (server-assigned, not client)', () => {
    expect(outbox).toMatch(/resolve_actor_provenance\(p_user_id\)/);
    expect(outbox).toMatch(/COALESCE\(v_prov\.data_origin, 'production_user'\)/);
  });

  it('claim is concurrency-safe (FOR UPDATE SKIP LOCKED) and leases rows as sending', () => {
    expect(outbox).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(outbox).toMatch(/SET status = 'sending', attempt_count = t\.attempt_count \+ 1/);
  });

  it('mark applies bounded exponential backoff on failure and a fixed failure category', () => {
    expect(outbox).toMatch(/next_retry_at = now\(\) \+ \(LEAST\(power\(2/);
    expect(outbox).toMatch(/telemetry_outbox_failure_safe CHECK/);
  });

  it('worker RPCs are service-role-only', () => {
    expect(outbox).toMatch(/REVOKE ALL ON FUNCTION public\.claim_telemetry_batch\(integer\) FROM PUBLIC, anon, authenticated/);
    expect(outbox).toMatch(/REVOKE ALL ON FUNCTION public\.mark_telemetry_result\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  });
});
