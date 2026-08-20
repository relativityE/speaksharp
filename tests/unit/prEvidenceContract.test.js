import { describe, expect, it } from 'vitest';
import {
  validatePr,
  computeAcHash,
  acSectionNonEmpty,
  ciStatusFrom,
  extractSection,
  renderManagedBlock,
  parseManagedBlock,
  upsertManagedBlock,
  extractIssueRefs,
  selfTestData,
} from '../../scripts/pr-evidence-contract.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const AC = 'c'.repeat(64);

function make(o = {}) {
  const d = selfTestData();
  return { body: o.body ?? d.body, actual: { ...d.actual, ...(o.actual ?? {}) }, draft: o.draft ?? false };
}
const fails = (o) => validatePr(make(o)).length > 0;

describe('valid controls pass', () => {
  it('accepts a review-ready PR with no author attestations', () => {
    expect(/\[[ x]\]/.test(selfTestData().body)).toBe(false);
    expect(validatePr(make())).toEqual([]);
  });
  it('accepts a draft with pending CI', () => {
    const d = selfTestData();
    const body = d.body.replace('"status": "PASS"', '"status": "PENDING"');
    expect(validatePr({ body, draft: true, actual: { ...d.actual, ciConclusion: null, fullLane: false } })).toEqual([]);
  });
});

describe('the bot owns the facts', () => {
  it('rejects equal-but-fake head SHAs', () => { expect(fails({ body: selfTestData().body.replaceAll(HEAD, 'd'.repeat(40)) })).toBe(true); });
  it('rejects a stale base SHA', () => { expect(fails({ actual: { baseSha: 'e'.repeat(40) } })).toBe(true); });
  it('rejects a stale AC hash', () => { expect(fails({ actual: { acHash: 'e'.repeat(64) } })).toBe(true); });
  it('rejects an extra changed file', () => { expect(fails({ actual: { changedFiles: [...selfTestData().actual.changedFiles, 'README.md'] } })).toBe(true); });
  it('rejects a missing changed file', () => { expect(fails({ actual: { changedFiles: ['AGENTS.md'] } })).toBe(true); });
});

describe('issue-first (mechanical)', () => {
  it('rejects a missing governing issue reference', () => { expect(fails({ body: selfTestData().body.replace('Refs #1316', 'no issue') })).toBe(true); });
  it('rejects a nonexistent/unresolved governing issue', () => { expect(fails({ actual: { issueResolved: false } })).toBe(true); });
  it('rejects an issue created after the PR', () => { expect(fails({ actual: { issuePredates: false } })).toBe(true); });
  it('rejects an empty Acceptance criteria section', () => { expect(fails({ actual: { acNonEmpty: false } })).toBe(true); });
});

describe('exact-head full CI including pnpm quality', () => {
  it('rejects when the full lane did not run (fullLane false)', () => {
    expect(fails({ actual: { fullLane: false } })).toBe(true);
  });
  it('rejects a failed exact-head run', () => {
    expect(fails({ actual: { ciConclusion: 'failure' } })).toBe(true);
  });
  it('rejects author-forged CI PASS when the actual full lane did not pass', () => {
    // block hand-edited to PASS, but the actual run was not a full-lane success
    expect(fails({ actual: { fullLane: false, ciConclusion: 'success' } })).toBe(true);
  });
  it('accepts only a full-lane success', () => {
    expect(validatePr(make({ actual: { fullLane: true, ciConclusion: 'success' } }))).toEqual([]);
  });
});

describe('structured block + author prose', () => {
  it('rejects an invalid CI status enum', () => { expect(fails({ body: selfTestData().body.replace('"status": "PASS"', '"status": "GREENISH"') })).toBe(true); });
  it('rejects a missing managed block', () => { expect(fails({ body: selfTestData().body.replace(/<!-- pr-evidence-bot:v1:start -->[\s\S]*<!-- pr-evidence-bot:v1:end -->/, '') })).toBe(true); });
  it('rejects a missing author section', () => { expect(fails({ body: selfTestData().body.replace('## User outcome', '## Removed') })).toBe(true); });
});

describe('pure helpers', () => {
  const issue = ['## Acceptance criteria', '- [ ] a', '- [ ] b', '', '## Next'].join('\n');
  it('ciStatusFrom: full-lane success is PASS; anything else is PENDING/FAIL', () => {
    expect(ciStatusFrom({ conclusion: 'success', fullLane: true })).toBe('PASS');
    expect(ciStatusFrom({ conclusion: 'success', fullLane: false })).toBe('PENDING');
    expect(ciStatusFrom({ conclusion: 'failure', fullLane: true })).toBe('FAIL');
    expect(ciStatusFrom({ conclusion: null, fullLane: false })).toBe('PENDING');
  });
  it('computeAcHash is stable, whitespace-normalized, and content-sensitive', () => {
    expect(computeAcHash(issue)).toBe(computeAcHash(issue.replace('- [ ] a', '- [ ]   a   ')));
    expect(computeAcHash(issue)).not.toBe(computeAcHash(issue.replace('- [ ] b', '- [ ] c')));
    expect(computeAcHash(issue)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('acSectionNonEmpty detects an empty AC section', () => {
    expect(acSectionNonEmpty('## Acceptance criteria\n\n## Next')).toBe(false);
    expect(acSectionNonEmpty(issue)).toBe(true);
  });
  it('extractSection ignores commented headings', () => {
    expect(extractSection('<!-- ## Real\nx -->\n## Real\ny', 'Real')).toBe('y');
  });
  it('render/parse round-trips and sorts changed_files', () => {
    expect(parseManagedBlock(renderManagedBlock({ head_sha: HEAD, base_sha: BASE, changed_files: ['b', 'a'], ac_hash: AC, ci: { status: 'PASS', link: '' } })).changed_files).toEqual(['a', 'b']);
  });
  it('upsertManagedBlock is idempotent', () => {
    const block = renderManagedBlock({ head_sha: HEAD, base_sha: BASE, changed_files: [], ac_hash: AC, ci: { status: 'PENDING', link: '' } });
    const once = upsertManagedBlock('## User outcome\nx\n', block);
    expect(upsertManagedBlock(once, block)).toBe(once);
  });
  it('extractIssueRefs ignores commented refs', () => {
    expect(extractIssueRefs('<!-- Refs #9 -->\nRefs #1316')).toEqual([1316]);
  });
});
