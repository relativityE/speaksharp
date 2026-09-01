import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/db-grant-check.yml'), 'utf8');

describe('#1261 read-only DB grant workflow', () => {
  it('accepts only closed audit modes and never interpolates a free-form function signature', () => {
    expect(workflow).toContain('type: choice');
    expect(workflow).toContain('- full_scan');
    expect(workflow).toContain('- get_user_id_by_email');
    expect(workflow).not.toContain('function_signature:');
    expect(workflow).not.toMatch(/\$\{\{[^}]*function_signature/);
    expect(workflow).toContain("FN='public.get_user_id_by_email(text)'");
  });

  it('fails closed on HTTP errors, timeouts, invalid JSON, and an unexpected response shape', () => {
    // THREE query steps now: the two SECURITY DEFINER scans and the issue-report column audit. The
    // count is asserted rather than a mere presence check precisely so that ADDING a step forces this
    // review — a new step that queried the database without these guards would otherwise inherit the
    // suite's approval silently, which is how the column audit shipped without them the first time.
    const QUERY_STEPS = 3;
    expect(workflow.match(/set -euo pipefail/g)?.length).toBe(QUERY_STEPS);
    expect(workflow.match(/--fail-with-body/g)?.length).toBe(QUERY_STEPS);
    expect(workflow.match(/--show-error/g)?.length).toBe(QUERY_STEPS);
    expect(workflow.match(/--connect-timeout 10/g)?.length).toBe(QUERY_STEPS);
    expect(workflow.match(/--max-time 30/g)?.length).toBe(QUERY_STEPS);
    // Every step must VALIDATE the response shape, not merely fetch it.
    expect(workflow.match(/invalid query response/g)?.length).toBe(2);
    expect(workflow.match(/invalid response field type/g)?.length).toBe(2);
    expect(workflow).toContain('json.load(sys.stdin)');
    expect(workflow).toContain('invalid grant-check response');
    expect(workflow).toContain('invalid query response');
    expect(workflow).toContain('invalid response field type');
  });

  it('reports four-role privileges for all functions and flags every path without explicit pg_temp last', () => {
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(workflow).toContain(`has_function_privilege('${role}', p.oid, 'EXECUTE')`);
    }
    expect(workflow).toContain('AS functions');
    expect(workflow).toContain('AS exposed');
    expect(workflow).toContain('AS unsafe_search_paths');
    expect(workflow).toContain("!~ '(^|,)pg_temp$'");
    expect(workflow).toContain("(has_function_privilege('public', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))");
  });
});
