// #1097 PR-A — contract test for the SECURITY DEFINER classification replay normalizer.
//
// PROVES the normalizer only touches allowlisted RLS-policy DDL and NEVER transforms a function definition,
// GRANT, REVOKE, or table DDL statement — so the effective privilege state it classifies is exactly what the
// committed migrations produce.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeForReplay, NORMALIZE_ALLOWLIST } from '../../scripts/secdef-normalize-migration.mjs';

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/supabase/migrations');
const read = (base) => fs.readFileSync(path.join(MIG, base), 'utf8');

// Remove every CREATE/DROP POLICY statement (through its terminating semicolon). What remains is the
// non-policy DDL — function defs, grants, revokes, tables, etc. If normalization changed ONLY policy DDL,
// the residue is byte-identical before and after.
const stripPolicyDDL = (sql) => sql.replace(/\b(?:CREATE|DROP)\s+POLICY[\s\S]*?;/gi, '');
// Collapse only cosmetic horizontal whitespace so the inline `DROP …; ` guard's inter-statement space
// doesn't read as a residue change. Any real function/grant/revoke/table text change would still differ.
const wsNorm = (s) => s.replace(/[ \t]+/g, ' ').replace(/[ \t]+$/gm, '');
const countKeyword = (sql, re) => (sql.match(re) || []).length;
const NON_POLICY_DDL = [
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/gi,
  /\bGRANT\b/gi,
  /\bREVOKE\b/gi,
  /CREATE\s+TABLE/gi,
  /ALTER\s+TABLE/gi,
  /ALTER\s+FUNCTION/gi,
];

describe('#1097 secdef replay normalizer — contract', () => {
  it('exposes the EXACT allowlist (only known historical RLS-policy defects)', () => {
    expect([...NORMALIZE_ALLOWLIST.keys()]).toEqual(['20250825065500_fix_rls_performance_issue.sql']);
  });

  it('every allowlisted file exists and is actually transformed', () => {
    for (const base of NORMALIZE_ALLOWLIST.keys()) {
      const raw = read(base);
      const out = normalizeForReplay(raw, base);
      expect(out).not.toBe(raw); // it did normalize (else the allowlist entry is stale)
    }
  });

  it('normalization changes ONLY RLS-policy DDL — no function/grant/revoke/table DDL is transformed', () => {
    for (const base of NORMALIZE_ALLOWLIST.keys()) {
      const raw = read(base);
      const out = normalizeForReplay(raw, base);
      // The non-policy residue is identical before and after (modulo the inline guard's cosmetic space).
      expect(wsNorm(stripPolicyDDL(out))).toBe(wsNorm(stripPolicyDDL(raw)));
      // And every non-policy DDL keyword count is unchanged.
      for (const re of NON_POLICY_DDL) {
        expect(countKeyword(out, re)).toBe(countKeyword(raw, re));
      }
    }
  });

  it('a NON-allowlisted migration is returned byte-identical even when it contains policy DDL', () => {
    // initial_schema creates an RLS policy but is NOT allowlisted → must pass through unchanged.
    const base = '20250811062708_initial_schema.sql';
    const raw = read(base);
    expect(raw).toMatch(/CREATE POLICY/i); // sanity: it does contain policy DDL
    expect(normalizeForReplay(raw, base)).toBe(raw);
  });

  it('is a pure pass-through for an unknown filename', () => {
    const sql = 'CREATE POLICY "x" ON public.t FOR ALL USING (true);\nGRANT EXECUTE ON FUNCTION public.f() TO anon;';
    expect(normalizeForReplay(sql, 'not-a-real-migration.sql')).toBe(sql);
  });
});
