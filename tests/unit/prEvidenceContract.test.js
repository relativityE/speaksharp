import { describe, expect, it } from 'vitest';
import { validatePrBody } from '../../scripts/pr-evidence-contract.mjs';

// A complete, review-ready PR body that must pass validation as non-draft.
// Browser/deployed proof takes the NOT REQUIRED path here; a separate fixture
// below exercises the REQUIRED release-identity path.
const REVIEW_READY = `<!-- speaksharp-pr-contract:v1 -->
## PR lifecycle gate
- Current phase: Phase 2 — Review-ready
- Allowed next transition: Phase 3 — Under review
- Active review return: None.
- Correction round count: 0
- Correction disposition: N/A — not yet at the second correction loop
- Review cadence: One consolidated PM review per review-ready state.
- Stop rule: Missing preconditions => VOID; a second correction loop forces regenerate or rescope.
- Separate authorities: Merge, migration, deployment, activation, and production proof are separately authorized.
## Governing issue
Refs #1316
## User outcome
A repository mechanism prevents stale qualification.
## Scope and allowlist
- Changed-file allowlist: .github/pull_request_template.md
- Explicitly out of scope: Product code
- Production action on merge: None
## Exact artifact and freshness
- PR head SHA: abcdef123456
- Remote PR head SHA: abcdef123456
- Base/main SHA: 123456abcdef
- Worktree state: clean
- Tool/runtime versions: Node 22
- Artifact hashes: N/A — no generated artifact changed
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
- Mutation proof: Removed the issue link and observed nonzero validation.
## Limitations and dependencies
- Known limitations: Template enforcement begins after merge
- Dependencies/ordering: Merge separately authorized
- Substitutions used only for diagnosis: None
## Status
- Status: QUALIFIED
## Review readiness
- [x] Complete
`;

// A review-ready body that asserts REQUIRED browser/deployed proof with a matching
// release identity and verified selectors.
const BROWSER_REQUIRED = REVIEW_READY
  .replace('- Browser/deployed proof: NOT REQUIRED — repository metadata only', '- Browser/deployed proof: REQUIRED')
  .replace('- Target URL/environment: N/A — no runtime changed', '- Target URL/environment: https://speaksharp-public.vercel.app/')
  .replace('- Expected deployed SHA: N/A — no deployment required', '- Expected deployed SHA: abcdef123456')
  .replace('- Browser release identity: N/A — no browser evidence used', '- Browser release identity: abcdef123456')
  .replace('- Browser release match: N/A — no browser evidence used', '- Browser release match: YES')
  .replace('- Cache/reload action: N/A — no browser evidence used', '- Cache/reload action: Reloaded with cache disabled')
  .replace('- Harness/selectors verified against exact release: N/A — no harness changed', '- Harness/selectors verified against exact release: YES');

function fails(body, { draft = false } = {}) {
  return validatePrBody(body, { draft }).length > 0;
}

describe('PR evidence contract — valid controls pass', () => {
  it('accepts a complete review-ready body', () => {
    expect(validatePrBody(REVIEW_READY, { draft: false })).toEqual([]);
  });

  it('accepts a valid draft with unresolved evidence still PENDING', () => {
    const draft = REVIEW_READY
      .replace('- Status: QUALIFIED', '- Status: OPEN')
      .replace('\nNone.\n## Mutation / failure proof', '\nPENDING\n## Mutation / failure proof')
      .replace('- Current phase: Phase 2 — Review-ready', '- Current phase: Phase 1 — Draft');
    expect(validatePrBody(draft, { draft: true })).toEqual([]);
  });

  it('accepts a REQUIRED browser proof with matching release and verified selectors', () => {
    expect(validatePrBody(BROWSER_REQUIRED, { draft: false })).toEqual([]);
  });

  it('accepts a body whose only real ref is author-supplied even if a comment shows an example', () => {
    const withCommentExample = REVIEW_READY.replace(
      '## Governing issue\nRefs #1316',
      '## Governing issue\n<!-- Use Refs #123 for an increment -->\nRefs #1316',
    );
    expect(validatePrBody(withCommentExample, { draft: false })).toEqual([]);
  });

  it('accepts a correctly regenerated second correction loop', () => {
    const regenerated = REVIEW_READY
      .replace('Correction round count: 0', 'Correction round count: 2')
      .replace('Correction disposition: N/A — not yet at the second correction loop', 'Correction disposition: Rescoped to a smaller increment');
    expect(validatePrBody(regenerated, { draft: false })).toEqual([]);
  });
});

describe('PR evidence contract — every load-bearing control fails when broken', () => {
  it('rejects a missing lifecycle heading', () => {
    expect(fails(REVIEW_READY.replace('## PR lifecycle gate', '## Removed lifecycle'))).toBe(true);
  });

  it('rejects a wrong current phase on a review-ready PR', () => {
    expect(fails(REVIEW_READY.replace('Current phase: Phase 2 — Review-ready', 'Current phase: Phase 1 — Draft'))).toBe(true);
  });

  it('rejects a missing current-phase field', () => {
    expect(fails(REVIEW_READY.replace('- Current phase: Phase 2 — Review-ready\n', ''))).toBe(true);
  });

  it('rejects a wrong allowed next transition', () => {
    expect(fails(REVIEW_READY.replace('Allowed next transition: Phase 3 — Under review', 'Allowed next transition: Phase 5 — Apply'))).toBe(true);
  });

  it('rejects an unresolved active review return', () => {
    expect(fails(REVIEW_READY.replace('Active review return: None.', 'Active review return: PM return open'))).toBe(true);
  });

  it('rejects a non-integer correction round count', () => {
    expect(fails(REVIEW_READY.replace('Correction round count: 0', 'Correction round count: three'))).toBe(true);
  });

  it('rejects a second correction loop without a regenerate/rescope disposition', () => {
    const mutated = REVIEW_READY
      .replace('Correction round count: 0', 'Correction round count: 2')
      .replace('Correction disposition: N/A — not yet at the second correction loop', 'Correction disposition: patched again');
    expect(fails(mutated)).toBe(true);
  });

  it('rejects a correction count over the two-loop cap', () => {
    expect(fails(REVIEW_READY.replace('Correction round count: 0', 'Correction round count: 3'))).toBe(true);
  });

  it('rejects a stale head (PR head != remote head)', () => {
    expect(fails(REVIEW_READY.replace('Remote PR head SHA: abcdef123456', 'Remote PR head SHA: fedcba654321'))).toBe(true);
  });

  it('rejects pending evidence on a review-ready PR', () => {
    expect(fails(REVIEW_READY.replace('\nNone.\n## Mutation / failure proof', '\nPENDING\n## Mutation / failure proof'))).toBe(true);
  });

  it('rejects unchecked review-readiness boxes', () => {
    expect(fails(REVIEW_READY.replace('- [x] Complete', '- [ ] Complete'))).toBe(true);
  });

  it('rejects a status that is not QUALIFIED', () => {
    expect(fails(REVIEW_READY.replace('- Status: QUALIFIED', '- Status: OPEN'))).toBe(true);
  });

  it('rejects a missing governing-issue reference', () => {
    expect(fails(REVIEW_READY.replace('Refs #1316', 'No issue'))).toBe(true);
  });

  it('rejects a body whose only issue reference lives inside an HTML comment', () => {
    const commentedOnly = REVIEW_READY.replace('Refs #1316', '<!-- Refs #1316 -->');
    expect(fails(commentedOnly)).toBe(true);
  });

  it('rejects a missing contract marker', () => {
    expect(fails(REVIEW_READY.replace('<!-- speaksharp-pr-contract:v1 -->', ''))).toBe(true);
  });

  it('rejects a stale/mismatched browser release when proof is REQUIRED', () => {
    expect(fails(BROWSER_REQUIRED.replace('Browser release identity: abcdef123456', 'Browser release identity: fedcba654321'))).toBe(true);
  });

  it('rejects an unverified browser-release match when proof is REQUIRED', () => {
    expect(fails(BROWSER_REQUIRED.replace('Browser release match: YES', 'Browser release match: NO'))).toBe(true);
  });

  it('rejects dead/unverified selector verification when proof is REQUIRED', () => {
    expect(fails(BROWSER_REQUIRED.replace('Harness/selectors verified against exact release: YES', 'Harness/selectors verified against exact release: not checked'))).toBe(true);
  });

  it('rejects an ambiguous browser proof that is neither REQUIRED nor NOT REQUIRED', () => {
    expect(fails(REVIEW_READY.replace('- Browser/deployed proof: NOT REQUIRED — repository metadata only', '- Browser/deployed proof: PENDING'))).toBe(true);
  });
});
