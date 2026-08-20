import { describe, expect, it } from 'vitest';
import {
  validatePr,
  classifyTier,
  computeAcHash,
  acSectionNonEmpty,
  extractSection,
  renderManagedBlock,
  parseManagedBlock,
  upsertManagedBlock,
  reconcileEvidence,
  extractIssueRefs,
  parseBreakGlass,
  breakGlassValid,
  selfTestData,
} from '../../scripts/pr-evidence-contract.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const AC = 'c'.repeat(64);

function make(overrides = {}) {
  const d = selfTestData();
  const body = overrides.body ?? d.body;
  const actual = { ...d.actual, ...(overrides.actual ?? {}) };
  return { body, actual, draft: overrides.draft ?? false };
}
const fails = (o) => validatePr(make(o)).length > 0;

describe('valid controls pass', () => {
  it('accepts a complete review-ready LIGHT PR', () => {
    expect(validatePr(make())).toEqual([]);
  });
  it('accepts a draft with pending CI evidence', () => {
    const d = selfTestData();
    const body = d.body.replace('"status": "PASS"', '"status": "PENDING"');
    expect(validatePr({ body, draft: true, actual: { ...d.actual, finalCi: 'pending' } })).toEqual([]);
  });
});

describe('two clocks — bot facts vs actual GitHub facts', () => {
  it('rejects equal-but-fake head SHAs (agree with each other, not GitHub)', () => {
    const d = selfTestData();
    expect(fails({ body: d.body.replaceAll(HEAD, 'd'.repeat(40)) })).toBe(true);
  });
  it('rejects a stale base SHA', () => {
    expect(fails({ actual: { baseSha: 'e'.repeat(40) } })).toBe(true);
  });
  it('rejects a stale AC hash (intent clock moved)', () => {
    expect(fails({ actual: { acHash: 'e'.repeat(64) } })).toBe(true);
  });
  it('rejects an extra changed file', () => {
    expect(fails({ actual: { changedFiles: ['AGENTS.md', 'scripts/pr-evidence-contract.mjs', 'tests/unit/prEvidenceContract.test.js', 'README.md'] } })).toBe(true);
  });
  it('rejects a missing changed file', () => {
    expect(fails({ actual: { changedFiles: ['AGENTS.md'] } })).toBe(true);
  });
  it('marks evidence STALE and blocks after a head change', () => {
    expect(fails({ actual: { headSha: 'f'.repeat(40) } })).toBe(true);
  });
});

describe('risk tiers and anti-downgrade', () => {
  it('classifies docs/CI/test-only changes as LIGHT', () => {
    expect(classifyTier(['AGENTS.md', 'scripts/pr-evidence-contract.mjs', 'tests/unit/x.test.js']).tier).toBe('LIGHT');
  });
  it('classifies a migration as FULL', () => {
    expect(classifyTier(['backend/supabase/migrations/x.sql']).tier).toBe('FULL');
  });
  it('classifies billing/auth/core paths as FULL', () => {
    expect(classifyTier(['frontend/src/services/stripe.ts']).tier).toBe('FULL');
    expect(classifyTier(['app/auth/login.ts']).tier).toBe('FULL');
  });
  it('rejects an author FULL->LIGHT downgrade (trusted classification wins)', () => {
    expect(fails({ actual: { changedFiles: ['AGENTS.md', 'scripts/pr-evidence-contract.mjs', 'tests/unit/prEvidenceContract.test.js', 'backend/supabase/migrations/x.sql'] } })).toBe(true);
  });
});

describe('structured status enum and managed block', () => {
  it('rejects an invalid structured status', () => {
    const d = selfTestData();
    expect(fails({ body: d.body.replace('"status": "PASS"', '"status": "GREENISH"') })).toBe(true);
  });
  it('rejects a missing managed block', () => {
    const d = selfTestData();
    expect(fails({ body: d.body.replace(/<!-- pr-evidence-bot:v1:start -->[\s\S]*<!-- pr-evidence-bot:v1:end -->/, '') })).toBe(true);
  });
  it('rejects final CI that is not green', () => {
    expect(fails({ actual: { finalCi: 'failure' } })).toBe(true);
  });
  it('rejects an unchecked author attestation', () => {
    const d = selfTestData();
    expect(fails({ body: d.body.replace('- [x] Scope is the smallest coherent increment', '- [ ] Scope is the smallest coherent increment') })).toBe(true);
  });
  it('rejects a missing author outcome section', () => {
    const d = selfTestData();
    expect(fails({ body: d.body.replace('## User outcome', '## Removed') })).toBe(true);
  });
});

describe('FULL tier evidence', () => {
  const d = selfTestData();
  const fullFiles = [...d.actual.changedFiles, 'frontend/src/services/x.ts'];
  function fullBody(evidence) {
    const block = renderManagedBlock({ tier: 'FULL', head_sha: HEAD, base_sha: BASE, changed_files: fullFiles, ac_hash: AC, evidence });
    return d.body.replace(/<!-- pr-evidence-bot:v1:start -->[\s\S]*<!-- pr-evidence-bot:v1:end -->/, block);
  }
  it('requires a passing mutation record for FULL', () => {
    const body = fullBody([{ id: 'ci', type: 'ci', status: 'PASS', sha: HEAD, ac_hash: AC, coverage: 'all', link: 'x' }]);
    expect(validatePr({ body, draft: false, actual: { ...d.actual, changedFiles: fullFiles } }).length).toBeGreaterThan(0);
  });
  it('accepts FULL with ci + mutation PASS', () => {
    const body = fullBody([
      { id: 'ci', type: 'ci', status: 'PASS', sha: HEAD, ac_hash: AC, coverage: 'all', link: 'x' },
      { id: 'mut', type: 'mutation', status: 'PASS', sha: HEAD, ac_hash: AC, coverage: 'all', link: 'y' },
    ]);
    expect(validatePr({ body, draft: false, actual: { ...d.actual, changedFiles: fullFiles } })).toEqual([]);
  });
  it('rejects a stale browser release (observed SHA != head)', () => {
    const body = fullBody([
      { id: 'ci', type: 'ci', status: 'PASS', sha: HEAD, ac_hash: AC, coverage: 'all', link: 'x' },
      { id: 'mut', type: 'mutation', status: 'PASS', sha: HEAD, ac_hash: AC, coverage: 'all', link: 'y' },
      { id: 'br', type: 'browser', status: 'PASS', sha: 'f'.repeat(40), ac_hash: AC, coverage: 'browser', link: 'z' },
    ]);
    expect(validatePr({ body, draft: false, actual: { ...d.actual, changedFiles: fullFiles } }).length).toBeGreaterThan(0);
  });
});

describe('pure helpers', () => {
  const issue = ['## Acceptance criteria', '- [ ] a', '- [ ] b', '', '## Next'].join('\n');
  it('computeAcHash is stable and whitespace-normalized', () => {
    const h1 = computeAcHash(issue);
    const h2 = computeAcHash(issue.replace('- [ ] a', '- [ ]   a   '));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });
  it('computeAcHash changes when AC content changes', () => {
    expect(computeAcHash(issue)).not.toBe(computeAcHash(issue.replace('- [ ] b', '- [ ] c')));
  });
  it('computeAcHash returns null with no AC section', () => {
    expect(computeAcHash('## Something else\nx')).toBeNull();
  });
  it('acSectionNonEmpty detects an empty AC section', () => {
    expect(acSectionNonEmpty('## Acceptance criteria\n\n## Next')).toBe(false);
    expect(acSectionNonEmpty(issue)).toBe(true);
  });
  it('extractSection ignores commented headings', () => {
    expect(extractSection('<!-- ## Acceptance criteria\nx -->\n## Real\ny', 'Real')).toBe('y');
  });
  it('render/parse round-trips the managed block', () => {
    const facts = { tier: 'LIGHT', head_sha: HEAD, base_sha: BASE, changed_files: ['b', 'a'], ac_hash: AC, evidence: [] };
    const parsed = parseManagedBlock(renderManagedBlock(facts));
    expect(parsed.changed_files).toEqual(['a', 'b']);
    expect(parsed.tier).toBe('LIGHT');
  });
  it('upsertManagedBlock is idempotent', () => {
    const block = renderManagedBlock({ tier: 'LIGHT', head_sha: HEAD, base_sha: BASE, changed_files: [], ac_hash: AC, evidence: [] });
    const once = upsertManagedBlock('## User outcome\nx\n', block);
    expect(upsertManagedBlock(once, block)).toBe(once);
  });
  it('reconcileEvidence marks moved-clock evidence STALE', () => {
    const ev = [{ id: 'x', type: 'ci', status: 'PASS', sha: HEAD, ac_hash: AC, coverage: 'all' }];
    expect(reconcileEvidence(ev, 'f'.repeat(40), AC)[0].status).toBe('STALE');
    expect(reconcileEvidence(ev, HEAD, AC)[0].status).toBe('PASS');
  });
  it('extractIssueRefs ignores commented refs', () => {
    expect(extractIssueRefs('<!-- Refs #9 -->\nRefs #1316')).toEqual([1316]);
  });
  it('break-glass requires owner, scope, expiry, and follow-up', () => {
    const rec = parseBreakGlass('BREAK-GLASS APPROVED\nowner: po\nscope: hotfix\nexpiry: 2026-08-21\nfollow-up: #99\n');
    expect(breakGlassValid(rec)).toBe(true);
    expect(breakGlassValid(parseBreakGlass('BREAK-GLASS APPROVED\nowner: po\n'))).toBe(false);
  });
});
