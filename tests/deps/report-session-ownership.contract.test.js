import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Static contract for the report→session ownership guard migration. Asserts the migration's SEMANTIC
// shape (fail-closed coercion, no rejection, no RLS/grant/column changes) without needing a database.
const HERE = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(HERE, '../../backend/supabase/migrations/20260721130000_report_session_ownership_guard.sql'),
  'utf8',
);
// Strip line-leading SQL comment markers so multi-line comment phrases read as continuous text,
// then collapse whitespace. (Assertions target the migration's semantic intent, comments included.)
const norm = sql.replace(/^\s*--\s?/gm, '').replace(/\s+/g, ' ');

describe('report_session_ownership_guard migration — static contract', () => {
  it('defines a SECURITY DEFINER trigger function with a pinned search_path', () => {
    expect(norm).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_report_session_ownership\(\)/i);
    expect(norm).toMatch(/SECURITY DEFINER/i);
    expect(norm).toMatch(/SET search_path = pg_catalog, public/i);
  });

  it('coerces session_id to NULL (fail-closed) and does NOT reject the report', () => {
    expect(norm).toMatch(/NEW\.session_id\s*:=\s*NULL/i);
    // Never rejects — persistence stays authoritative; a bad/foreign id must not abort the insert.
    expect(norm).not.toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('retains session_id only for a same-owner existing session (anonymous cannot own)', () => {
    expect(norm).toMatch(/NEW\.user_id IS NULL/i);
    expect(norm).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM public\.sessions s WHERE s\.id = NEW\.session_id AND s\.user_id = NEW\.user_id\s*\)/i);
  });

  it('revalidates on INSERT and on UPDATE of session_id and user_id', () => {
    expect(norm).toMatch(/BEFORE INSERT OR UPDATE OF session_id, user_id ON public\.user_issue_reports/i);
    expect(norm).toMatch(/FOR EACH ROW/i);
  });

  it('locks down function EXECUTE (revoke PUBLIC, grant only report-writing roles)', () => {
    expect(norm).toMatch(/REVOKE ALL ON FUNCTION public\.enforce_report_session_ownership\(\) FROM PUBLIC/i);
    expect(norm).toMatch(/GRANT EXECUTE ON FUNCTION public\.enforce_report_session_ownership\(\) TO authenticated, service_role/i);
  });

  it('does NOT change user_issue_reports RLS policies, grants, or columns', () => {
    expect(norm).not.toMatch(/CREATE POLICY/i);
    expect(norm).not.toMatch(/DROP POLICY/i);
    expect(norm).not.toMatch(/ALTER TABLE public\.user_issue_reports/i);
    expect(norm).not.toMatch(/GRANT[^;]*ON (TABLE )?public\.user_issue_reports/i);
    // No outbox/alert/provenance/worker/schedule/reconciliation scope creep.
    expect(norm).not.toMatch(/outbox|provenance|telemetry_|alert_deliveries|pg_cron|schedule|reconcil/i);
  });

  it('documents a rollback that drops trigger then function (and warns on ordering)', () => {
    expect(norm).toMatch(/DROP TRIGGER IF EXISTS trg_enforce_report_session_ownership/i);
    expect(norm).toMatch(/DROP FUNCTION IF EXISTS public\.enforce_report_session_ownership/i);
    expect(norm).toMatch(/REVERT THE CLIENT ATTRIBUTION CHANGE FIRST/i);
  });
});
