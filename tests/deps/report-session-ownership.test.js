import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P0 incident guard: the report→session association must be enforced at the trusted DB boundary,
// not just by the client route helper. Locks the trigger shape so a future migration can't drop it.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sql = readFileSync(
  resolve(ROOT, 'backend/supabase/migrations/20260720140000_report_session_ownership_guard.sql'),
  'utf8',
);

describe('P0 — server-side report/session ownership enforcement', () => {
  it('defines a BEFORE INSERT OR UPDATE trigger on user_issue_reports', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_enforce_report_session_ownership/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF session_id, user_id ON public\.user_issue_reports/);
  });

  it('coerces session_id to NULL unless the session belongs to the SAME account', () => {
    // ownership predicate: sessions.user_id = the report's user_id
    expect(sql).toMatch(/s\.id = NEW\.session_id/);
    expect(sql).toMatch(/s\.user_id = NEW\.user_id/);
    expect(sql).toMatch(/NEW\.session_id := NULL/);
  });

  it('fails closed for anonymous reports (user_id IS NULL cannot claim a session)', () => {
    expect(sql).toMatch(/NEW\.user_id IS NULL/);
  });
});
