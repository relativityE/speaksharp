import { describe, expect, it } from 'vitest';
import {
  validatePrBody,
  validateGoverningIssue,
  parseAllowlist,
  extractIssueRefs,
  stripComments,
  PR_CONTRACT_MARKER,
  ISSUE_CONTRACT_MARKER,
} from '../../scripts/pr-evidence-contract.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

const CANONICAL_ISSUE = {
  number: 1316,
  isPullRequest: false,
  createdAt: '2026-08-18T00:00:00Z',
  body: [
    '### User outcome', 'A durable lifecycle gate.', '',
    '### Observed problem and exact evidence', 'Green CI hid false-green paths.', '',
    '### Highest risk boundary', 'Deployment or release automation', '',
    '### Acceptance criteria', '- [ ] Trusted-base validator', '',
    '### Required evidence', 'Exact-head CI and mutation proof.', '',
    '### Proposed PR increment and file allowlist', 'Eight governance files.', '',
    '### Dependencies, ordering, and authorization gates', 'Merge separately authorized.', '',
  ].join('\n'),
};

const V1_ISSUE = {
  number: 1316,
  isPullRequest: false,
  createdAt: '2026-08-18T00:00:00Z',
  body: [
    `<!-- ${ISSUE_CONTRACT_MARKER} -->`,
    '## Implementation lifecycle gate',
    '- Status: **ACTIVE**',
    '- Current phase: 1 — enforcement implementation',
    '- Separate authorities: review, merge, deployment, and production are independent.',
    '## Outcome',
    'Every implementation begins with an issue and a linked Draft PR.',
  ].join('\n'),
};

const REVIEW_READY = `${PR_CONTRACT_MARKER}
## PR lifecycle gate
- Current phase: Phase 2 — Review-ready
- Allowed next transition: Phase 3 — Under review
- Active review return: None.
- Correction round count: 0
- Correction disposition: N/A — not at the second correction loop yet
- Review cadence: One consolidated PM review per review-ready state.
- Stop rule: Missing preconditions => VOID; a second correction loop forces regenerate or rescope.
- Separate authorities: Merge, migration, deployment, activation, and production proof are separately authorized.
## Governing issue
Refs #1316
## User outcome
A repository mechanism prevents stale qualification.
## Scope and allowlist
- Changed-file allowlist: see the machine-readable block below
- Explicitly out of scope: Product code
- Production action on merge: None

\`\`\`files
AGENTS.md
scripts/pr-evidence-contract.mjs
\`\`\`
## Exact artifact and freshness
- PR head SHA: ${HEAD}
- Remote PR head SHA: ${HEAD}
- Base/main SHA: ${BASE}
- Worktree state: clean
- Tool/runtime versions: Node 22.12.0
- Artifact hashes: AGENTS.md ${H1}; scripts/pr-evidence-contract.mjs ${H2}
- Evidence scope: exact head
### Browser/deployed freshness
- Browser/deployed proof: NOT REQUIRED — repository metadata only
- Target URL/environment: N/A — no runtime changed
- Expected deployed SHA: N/A — no deployment required
- Browser release identity: N/A — no browser evidence used
- Browser release match: N/A — no browser evidence used
- Cache/reload action: N/A — no browser evidence used
- Harness/selectors verified against exact release: N/A — no harness changed
## Evidence completed
Validator self-test passed on exact head.
## Evidence pending
None.
## Mutation / failure proof
- Mutation proof: Broke each control and observed a nonzero result.
## Limitations and dependencies
- Known limitations: Enforcement binds once the base contains this validator.
- Dependencies/ordering: Merge separately authorized.
- Substitutions used only for diagnosis: None
## Status
- Status: QUALIFIED
## Review readiness
- [x] Complete
`;

const OPTS = {
  draft: false,
  actualHeadSha: HEAD,
  actualBaseSha: BASE,
  changedFiles: ['AGENTS.md', 'scripts/pr-evidence-contract.mjs'],
  fileHashes: [
    { path: 'AGENTS.md', sha256: H1 },
    { path: 'scripts/pr-evidence-contract.mjs', sha256: H2 },
  ],
  governingIssues: [CANONICAL_ISSUE],
  prCreatedAt: '2026-08-20T00:00:00Z',
};

const fails = (body, opts = OPTS) => validatePrBody(body, opts).length > 0;

describe('valid controls pass', () => {
  it('accepts a complete review-ready body against actual GitHub metadata', () => {
    expect(validatePrBody(REVIEW_READY, OPTS)).toEqual([]);
  });
  it('accepts a valid draft with unresolved evidence still PENDING', () => {
    const draft = REVIEW_READY
      .replace('- Status: QUALIFIED', '- Status: OPEN')
      .replace('- Current phase: Phase 2 — Review-ready', '- Current phase: Phase 1 — Draft')
      .replace('\nNone.\n## Mutation', '\nPENDING — implementation in progress\n## Mutation');
    expect(validatePrBody(draft, { draft: true, governingIssues: [CANONICAL_ISSUE], prCreatedAt: OPTS.prCreatedAt })).toEqual([]);
  });
  it('accepts a v1-contract governing issue', () => {
    expect(validatePrBody(REVIEW_READY, { ...OPTS, governingIssues: [V1_ISSUE] })).toEqual([]);
  });
  it('accepts a correctly regenerated second correction loop', () => {
    const body = REVIEW_READY
      .replace('- Correction round count: 0', '- Correction round count: 2')
      .replace('- Correction disposition: N/A — not at the second correction loop yet', '- Correction disposition: Regenerated from authoritative sources');
    expect(validatePrBody(body, OPTS)).toEqual([]);
  });
  it('accepts a REQUIRED browser proof with matching release and verified selectors', () => {
    const body = REVIEW_READY
      .replace('- Browser/deployed proof: NOT REQUIRED — repository metadata only', '- Browser/deployed proof: REQUIRED')
      .replace('- Target URL/environment: N/A — no runtime changed', '- Target URL/environment: https://example.test/')
      .replace('- Expected deployed SHA: N/A — no deployment required', `- Expected deployed SHA: ${HEAD}`)
      .replace('- Browser release identity: N/A — no browser evidence used', `- Browser release identity: ${HEAD}`)
      .replace('- Browser release match: N/A — no browser evidence used', '- Browser release match: YES')
      .replace('- Cache/reload action: N/A — no browser evidence used', '- Cache/reload action: Reloaded with cache disabled')
      .replace('- Harness/selectors verified against exact release: N/A — no harness changed', '- Harness/selectors verified against exact release: YES');
    expect(validatePrBody(body, OPTS)).toEqual([]);
  });
});

describe('P1-2 — exact artifact compared with GitHub actuals', () => {
  it('rejects a reported head that does not match the actual head', () => {
    expect(fails(REVIEW_READY.replaceAll(HEAD, 'd'.repeat(40)))).toBe(true);
  });
  it('rejects equal-but-fake head/remote values (agree with each other, not with GitHub)', () => {
    const body = REVIEW_READY.replaceAll(HEAD, 'f'.repeat(40));
    // reported head === reported remote, but neither equals actualHeadSha
    expect(fails(body)).toBe(true);
  });
  it('rejects a stale base SHA', () => {
    expect(fails(REVIEW_READY.replace(`- Base/main SHA: ${BASE}`, `- Base/main SHA: ${'e'.repeat(40)}`))).toBe(true);
  });
  it('rejects a 7-char short head SHA', () => {
    expect(fails(REVIEW_READY.replace(`- PR head SHA: ${HEAD}`, '- PR head SHA: abcdef1'))).toBe(true);
  });
  it('rejects an allowlist that omits a changed file', () => {
    expect(fails(REVIEW_READY, { ...OPTS, changedFiles: ['AGENTS.md', 'scripts/pr-evidence-contract.mjs', 'README.md'] })).toBe(true);
  });
  it('rejects an allowlist with a file that did not change', () => {
    expect(fails(REVIEW_READY, { ...OPTS, changedFiles: ['AGENTS.md'] })).toBe(true);
  });
  it('rejects a renamed file (new path present, old path gone)', () => {
    expect(fails(REVIEW_READY, { ...OPTS, changedFiles: ['AGENTS.md', 'scripts/pr-evidence-contract-renamed.mjs'] })).toBe(true);
  });
  it('rejects a missing machine-readable allowlist block', () => {
    expect(fails(REVIEW_READY.replace(/```files[\s\S]*?```/, ''))).toBe(true);
  });
});

describe('P1-3 — comment-safe, fail-closed parsing', () => {
  it('rejects a heading hidden inside an HTML comment', () => {
    expect(fails(REVIEW_READY.replace('## Status', '<!-- ## Status -->'))).toBe(true);
  });
  it('rejects a required field hidden inside an HTML comment', () => {
    expect(fails(REVIEW_READY.replace('- Stop rule:', '<!-- - Stop rule:'))).toBe(true);
  });
  it('rejects a PENDING field even with trailing prose', () => {
    expect(fails(REVIEW_READY.replace('- Worktree state: clean', '- Worktree state: PENDING — awaiting push'))).toBe(true);
  });
  it('rejects a missing review cadence field', () => {
    expect(fails(REVIEW_READY.replace(/- Review cadence: .*\n/, ''))).toBe(true);
  });
  it('rejects a missing stop rule field', () => {
    expect(fails(REVIEW_READY.replace(/- Stop rule: .*\n/, ''))).toBe(true);
  });
  it('rejects a missing separate authorities field', () => {
    expect(fails(REVIEW_READY.replace(/- Separate authorities: .*\n/, ''))).toBe(true);
  });
  it('rejects a missing correction disposition field', () => {
    expect(fails(REVIEW_READY.replace(/- Correction disposition: .*\n/, ''))).toBe(true);
  });
  it('rejects a missing production-effect field', () => {
    expect(fails(REVIEW_READY.replace(/- Production action on merge: .*\n/, ''))).toBe(true);
  });
});

describe('P1-4 — governing-issue Phase-0 validation', () => {
  it('passes the canonical implementation-form issue', () => {
    expect(validateGoverningIssue(CANONICAL_ISSUE)).toEqual([]);
  });
  it('passes the retrofitted v1-contract issue', () => {
    expect(validateGoverningIssue(V1_ISSUE)).toEqual([]);
  });
  it('fails a blank issue', () => {
    expect(validateGoverningIssue({ number: 1, isPullRequest: false, body: '' }).length).toBeGreaterThan(0);
  });
  it('fails an issue missing a Phase-0 section', () => {
    const missing = { ...CANONICAL_ISSUE, body: CANONICAL_ISSUE.body.replace('### Acceptance criteria\n- [ ] Trusted-base validator\n\n', '') };
    expect(validateGoverningIssue(missing).length).toBeGreaterThan(0);
  });
  it('fails an issue with an empty Phase-0 section', () => {
    const empty = { ...CANONICAL_ISSUE, body: CANONICAL_ISSUE.body.replace('A durable lifecycle gate.', '') };
    expect(validateGoverningIssue(empty).length).toBeGreaterThan(0);
  });
  it('fails a PR referenced as a governing issue', () => {
    expect(validateGoverningIssue({ number: 9, isPullRequest: true, body: CANONICAL_ISSUE.body }).length).toBeGreaterThan(0);
  });
  it('rejects a PR body whose governing issue was created after the PR', () => {
    const late = { ...CANONICAL_ISSUE, createdAt: '2026-08-25T00:00:00Z' };
    expect(fails(REVIEW_READY, { ...OPTS, governingIssues: [late] })).toBe(true);
  });
  it('rejects a PR body whose only reference is a blank pre-existing issue', () => {
    const blank = { number: 1316, isPullRequest: false, createdAt: '2026-08-01T00:00:00Z', body: '' };
    expect(fails(REVIEW_READY, { ...OPTS, governingIssues: [blank] })).toBe(true);
  });
  it('rejects a body whose only issue reference lives in an HTML comment', () => {
    expect(fails(REVIEW_READY.replace('Refs #1316', '<!-- Refs #1316 -->'))).toBe(true);
  });
});

describe('P1-5 — full SHA-256 hashes', () => {
  it('rejects 8-character hash prefixes', () => {
    expect(fails(REVIEW_READY.replace(H1, H1.slice(0, 8)))).toBe(true);
  });
  it('rejects a body missing one changed file SHA-256', () => {
    expect(fails(REVIEW_READY.replace(`; scripts/pr-evidence-contract.mjs ${H2}`, ''))).toBe(true);
  });
});

describe('lifecycle + readiness controls', () => {
  it('rejects wrong current phase', () => {
    expect(fails(REVIEW_READY.replace('Current phase: Phase 2 — Review-ready', 'Current phase: Phase 1 — Draft'))).toBe(true);
  });
  it('rejects wrong next transition', () => {
    expect(fails(REVIEW_READY.replace('Allowed next transition: Phase 3 — Under review', 'Allowed next transition: Phase 5 — Apply'))).toBe(true);
  });
  it('rejects unresolved active review return', () => {
    expect(fails(REVIEW_READY.replace('Active review return: None.', 'Active review return: PM return open'))).toBe(true);
  });
  it('rejects a non-integer correction count', () => {
    expect(fails(REVIEW_READY.replace('Correction round count: 0', 'Correction round count: three'))).toBe(true);
  });
  it('rejects a correction count over the two-loop cap', () => {
    expect(fails(REVIEW_READY.replace('Correction round count: 0', 'Correction round count: 3'))).toBe(true);
  });
  it('rejects a second loop without a regenerate/rescope disposition', () => {
    const body = REVIEW_READY
      .replace('Correction round count: 0', 'Correction round count: 2')
      .replace('Correction disposition: N/A — not at the second correction loop yet', 'Correction disposition: patched again');
    expect(fails(body)).toBe(true);
  });
  it('rejects pending evidence that is not exactly None.', () => {
    expect(fails(REVIEW_READY.replace('\nNone.\n## Mutation', '\nPENDING\n## Mutation'))).toBe(true);
  });
  it('rejects unchecked review-readiness boxes', () => {
    expect(fails(REVIEW_READY.replace('- [x] Complete', '- [ ] Complete'))).toBe(true);
  });
  it('rejects a status that is not QUALIFIED', () => {
    expect(fails(REVIEW_READY.replace('- Status: QUALIFIED', '- Status: OPEN'))).toBe(true);
  });
  it('rejects a missing contract marker', () => {
    expect(fails(REVIEW_READY.replace(PR_CONTRACT_MARKER, ''))).toBe(true);
  });
});

describe('pure helpers', () => {
  it('stripComments removes HTML comments', () => {
    expect(stripComments('a<!-- x -->b')).toBe('ab');
  });
  it('parseAllowlist reads the fenced files block', () => {
    expect(parseAllowlist('```files\nAGENTS.md\nx/y.ts\n```')).toEqual(['AGENTS.md', 'x/y.ts']);
  });
  it('extractIssueRefs ignores commented references', () => {
    expect(extractIssueRefs('<!-- Refs #99 -->\nRefs #1316')).toEqual([1316]);
  });
});
