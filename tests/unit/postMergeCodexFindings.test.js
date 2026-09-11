/**
 * #1430 fix-forward — the three Codex P1s that landed on #1430 AFTER it merged, and #1438's follow-ups.
 *
 *   `3991325303` — executable control files were not "substantive", so a control-only PR could never qualify.
 *   `3991388525` — a RESOLVED same-head P0/P1 stopped counting, so resolving a blocker bypassed re-review.
 *   `3991388531` — a clean result bound to the head by an abbreviated SHA prefix.
 *   `3992215898`, `3992367735`, `3992467525` — every later binding read generated comment TEXT (abbreviation
 *                  resolution, any full SHA, the designated field), and the review requester can steer text.
 *
 * PM DECISION `5639300027` (bounded option C): exact-head Codex completion binds only through a review
 * object's full `commit.oid` or Codex's structured review-summary system metadata. The metadata establishes
 * completion only; it never clears a P0/P1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateReviewQualification, isSubstantiveImplementationFile } from '../../scripts/review-qualification.mjs';
import { buildReviewReceipt, PULL_REQUEST_REVIEW_QUERY, readPullRequest } from '../../scripts/collect-review-qualification.mjs';

/** The reviewed head, and a different commit ground to share its 10-character footer. */
const HEAD = `0cb6b1ebaa${'b'.repeat(30)}`;
const COLLIDER = `0cb6b1ebaa${'c'.repeat(30)}`;
const FOOTER = HEAD.slice(0, 10);
const OLDER_HEAD = 'e'.repeat(40);
const REPO = 'relativityE/speaksharp';
const PR = 1500;
const bot = { login: 'chatgpt-codex-connector' };
const human = { login: 'relativityE' };
const at = (minute) => `2026-09-11T16:${String(minute).padStart(2, '0')}:00Z`;

/** Codex's clean result comment. Its text is never identity; `footer` is what its marker prints. */
const cleanResult = (footer, createdAt = at(25), author = bot) => ({
  id: `clean-${footer}-${createdAt}`, author, authorAssociation: 'NONE', createdAt,
  body: `Codex Review: Didn't find any major issues. Swish!\n\n**Reviewed commit:** \`${footer}\``,
});

/** Codex's review-summary comment, carrying the structured system metadata option C binds through. */
/** One Code Review row as Codex renders it. `commit` is its abbreviated DISPLAY commit, never identity. */
const codeRow = (state, commit = HEAD.slice(0, 7)) =>
  `| 📝 **Code Review** | ${state} <relative-time datetime="2026-09-11T16:26:00Z">2026-09-11T16:26:00Z</relative-time> | \`${commit}\` | Manual request |`;
const summaryBody = ({ meta = {}, raw = null, running = false, marker = true, blocks = 1, codeRows = null } = {}) => {
  const json = raw ?? JSON.stringify({
    blockingSeverityThreshold: 'P0', headSha: HEAD, mergeGateEnabled: false, pullRequestNumber: PR, repository: REPO,
    status: 'completed', ...meta,
  });
  const block = `<!-- codex-security-review:v1 ${json} -->`;
  return [
    marker ? '<!-- codex-pull-request-review-summary -->' : '',
    ...Array.from({ length: blocks }, () => block),
    '## Codex Review Summary',
    '| Review | Status | Commit | Review trigger |',
    '| --- | --- | --- | --- |',
    ...(codeRows ?? [codeRow(running ? '🔄 **Running**' : '✅ **Completed**')]),
    '| 🔒 **Security Review** | ✅ **Completed** | `0cb6b1e` | PR opened |',
  ].join('\n');
};
const summary = (options = {}, author = bot) => ({
  id: `summary-${JSON.stringify(options)}-${author.login}`, author, authorAssociation: 'NONE', createdAt: at(26),
  body: summaryBody(options),
});

const codexReview = (sha, submittedAt, { state = 'COMMENTED', body = '### 💡 Codex Review\n\nHere are some automated review suggestions.' } = {}) => ({
  author: bot, state, commit: { oid: sha }, submittedAt, body,
});
const findingThread = ({ sha = HEAD, isResolved, reviewState = 'COMMENTED' }) => ({
  isResolved,
  comments: {
    nodes: [{
      author: bot, body: '**P1 Badge** A release finding',
      commit: { oid: sha }, originalCommit: { oid: sha },
      pullRequestReview: { state: reviewState, commit: { oid: sha } },
    }],
    pageInfo: { hasPreviousPage: false },
  },
});

const pullRequest = ({
  head = HEAD, reviews = [], threads = [], comments = [], commentsTruncated = false,
  files = ['scripts/review-qualification.mjs'],
} = {}) => ({
  number: PR,
  headRefOid: head,
  baseRefName: 'main',
  baseRefOid: 'd'.repeat(40),
  baseRepository: { nameWithOwner: REPO },
  files: { nodes: files.map((path) => ({ path })), pageInfo: { hasNextPage: false } },
  reviews: { nodes: reviews, pageInfo: { hasPreviousPage: false } },
  reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false } },
  comments: { nodes: comments, pageInfo: { hasPreviousPage: commentsTruncated } },
});
const receiptFor = (pr) => buildReviewReceipt({ pullRequest: pr, expectedHeadSha: pr.headRefOid });

describe('#1430 fix-forward `3991325303` — executable control files are substantive implementation', () => {
  it('CASUALTY: control files that force the full CI lane count as implementation', () => {
    for (const path of [
      '.github/actions/setup-environment/action.yml',
      'frontend/vite.config.mjs',
      'frontend/vitest.config.mjs',
      'tsconfig.json',
      'playwright.config.ts',
      'frontend/tailwind.config.ts',
    ]) {
      expect({ path, substantive: isSubstantiveImplementationFile(path) }).toEqual({ path, substantive: true });
    }
  });

  it('CASUALTY: a clean exact-head review of a control-file-only PR qualifies', () => {
    const result = evaluateReviewQualification({
      currentSha: HEAD, reviewedSha: HEAD, reviewStatus: 'completed', findingCount: 0,
      changedFiles: ['.github/actions/setup-environment/action.yml'], generatedAt: new Date().toISOString(),
    });
    expect(result.reasons).not.toContain('no_substantive_implementation');
    expect(result.qualified).toBe(true);
  });

  it('CONTROL: prose and tests alone are still not implementation', () => {
    for (const path of [
      '.github/PULL_REQUEST_TEMPLATE.md', 'docs/findings/final-release-qualification.md',
      'tests/unit/finalReleaseQualification.test.js', 'frontend/src/components/__tests__/Navigation.component.test.tsx',
    ]) {
      expect({ path, substantive: isSubstantiveImplementationFile(path) }).toEqual({ path, substantive: false });
    }
  });
});

describe('#1430 fix-forward `3991388525` — a resolved same-head blocker clears only through an authorized dismissal', () => {
  it('CASUALTY: a RESOLVED same-head Codex P1 blocks, even beside exact completed summary metadata', () => {
    const receipt = receiptFor(pullRequest({
      threads: [findingThread({ isResolved: true })],
      comments: [summary()],
    }));
    expect(receipt.findingCount).toBe(1);
    expect(receipt.qualified).toBe(false);
  });

  it('CASUALTY: no clean comment clears it — abbreviated or full marker', () => {
    for (const footer of [FOOTER, HEAD]) {
      const receipt = receiptFor(pullRequest({
        threads: [findingThread({ isResolved: true })],
        comments: [cleanResult(footer), summary()],
      }));
      expect({ footer, findingCount: receipt.findingCount }).toEqual({ footer, findingCount: 1 });
    }
  });

  it('CONTROL: a resolved finding inside an authorized DISMISSED review does not block', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5), { state: 'DISMISSED' })],
      threads: [findingThread({ isResolved: true, reviewState: 'DISMISSED' })],
      comments: [summary()],
    }));
    expect(receipt.findingCount).toBe(0);
    expect(receipt.qualified).toBe(true);
  });

  it('CONTROL: an UNRESOLVED same-head P1 blocks even when its review was dismissed', () => {
    const receipt = receiptFor(pullRequest({
      threads: [findingThread({ isResolved: false, reviewState: 'DISMISSED' })],
      comments: [summary()],
    }));
    expect(receipt.findingCount).toBe(1);
  });

  it('CONTROL: a resolved P1 from an OLDER head is historical and does not block the new head', () => {
    const receipt = receiptFor(pullRequest({
      threads: [findingThread({ sha: OLDER_HEAD, isResolved: true })],
      comments: [summary()],
    }));
    expect(receipt.findingCount).toBe(0);
    expect(receipt.qualified).toBe(true);
  });

  it("the live read selects each thread comment's review state", () => {
    expect(PULL_REQUEST_REVIEW_QUERY).toContain('pullRequestReview{state commit{oid}}');
  });
});

describe('#1438 PM DECISION `5639300027` — exact-head completion binds only through a review object or trusted summary metadata', () => {
  it('CASUALTY: a clean comment with only the normal 10-character footer and no system metadata holds', () => {
    const receipt = receiptFor(pullRequest({ comments: [cleanResult(FOOTER)] }));
    expect(receipt).toMatchObject({ qualified: false, reviewEvidence: null });
    expect(receipt.reasons).toContain('review_not_completed:missing');
  });

  it('CASUALTY: a full SHA in prose, a requester-steered marker, or a human-authored attestation holds', () => {
    const cases = {
      'full head in prose': { ...cleanResult(FOOTER), body: `Codex Review: Didn't find any major issues at ${HEAD}.` },
      'Codex comment with a full designated marker (`3992467525`)': cleanResult(HEAD),
      'human comment with a full marker': cleanResult(HEAD, at(25), human),
      'human-authored copy of the summary metadata': summary({}, human),
    };
    for (const [label, comment] of Object.entries(cases)) {
      const receipt = receiptFor(pullRequest({ comments: [comment] }));
      expect({ label, qualified: receipt.qualified, evidence: receipt.reviewEvidence })
        .toEqual({ label, qualified: false, evidence: null });
    }
  });

  it("CASUALTY (`3992467525`): review A's comment printing colliding B in the designated field does not qualify B", () => {
    const receipt = receiptFor(pullRequest({
      head: COLLIDER,
      comments: [cleanResult(COLLIDER), summary({ meta: { headSha: HEAD } })],
    }));
    expect(receipt).toMatchObject({ qualified: false, reviewEvidence: null });
  });

  it('CASUALTY: metadata for another head, repository or PR, malformed, duplicated, running, or not completed holds', () => {
    const cases = {
      'another head': { meta: { headSha: COLLIDER } },
      'abbreviated head': { meta: { headSha: FOOTER } },
      'uppercase head': { meta: { headSha: HEAD.toUpperCase() } },
      'another repository': { meta: { repository: 'someone/else' } },
      'another pull request': { meta: { pullRequestNumber: PR + 1 } },
      'pull request number as a string': { meta: { pullRequestNumber: String(PR) } },
      'status running': { meta: { status: 'running' } },
      'status missing': { raw: JSON.stringify({ headSha: HEAD, repository: REPO, pullRequestNumber: PR }) },
      'malformed JSON': { raw: `{"headSha":"${HEAD}","status":"completed"` },
      'metadata is an array': { raw: JSON.stringify([{ headSha: HEAD, status: 'completed' }]) },
      'duplicated block': { blocks: 2 },
      'a review still shown running': { running: true },
      'no summary marker': { marker: false },
    };
    for (const [label, options] of Object.entries(cases)) {
      const receipt = receiptFor(pullRequest({ comments: [summary(options)] }));
      expect({ label, qualified: receipt.qualified, evidence: receipt.reviewEvidence })
        .toEqual({ label, qualified: false, evidence: null });
    }
  });

  it('CASUALTY (`3992603040`): exact completed security metadata beside a code review that did not complete holds', () => {
    /**
     * The metadata is the SECURITY review's. A code review that failed or was cancelled leaves no `**Running**`
     * in the summary, so completion was accepted without a completed code review. PM DECISION `5639821873`:
     * exactly one canonical Code Review row, in `✅ **Completed**`; everything else holds.
     */
    const cases = {
      failed: [codeRow('❌ **Failed**')],
      cancelled: [codeRow('⛔ **Cancelled**')],
      running: [codeRow('🔄 **Running**')],
      'unknown state': [codeRow('❔ **Queued**')],
      missing: [],
      duplicated: [codeRow('✅ **Completed**'), codeRow('✅ **Completed**')],
      'completed and failed rows together': [codeRow('✅ **Completed**'), codeRow('❌ **Failed**')],
      'malformed label': [`| **Code Review** | ✅ **Completed** | \`${HEAD.slice(0, 7)}\` | Manual request |`],
      'malformed row (no status cell)': ['| 📝 **Code Review** |'],
      'Completed only in a later cell': [`| 📝 **Code Review** | ❌ **Failed** | ✅ **Completed** | Manual request |`],
    };
    for (const [label, codeRows] of Object.entries(cases)) {
      const receipt = receiptFor(pullRequest({ comments: [summary({ codeRows })] }));
      expect({ label, qualified: receipt.qualified, evidence: receipt.reviewEvidence })
        .toEqual({ label, qualified: false, evidence: null });
    }
  });

  it('CONTROL (`3992603040`): exact metadata plus exactly one Completed Code Review row and zero P0/P1 qualifies — the display commit is not identity', () => {
    // The row shows a different abbreviation on purpose: identity comes from the metadata head alone.
    const receipt = receiptFor(pullRequest({ comments: [summary({ codeRows: [codeRow('✅ **Completed**', 'deadbee')] })] }));
    expect(receipt).toMatchObject({ qualified: true, reviewEvidence: 'codex_summary_metadata', reviewedSha: HEAD });

    const otherHead = receiptFor(pullRequest({
      comments: [summary({ meta: { headSha: COLLIDER }, codeRows: [codeRow('✅ **Completed**', HEAD.slice(0, 7))] })],
    }));
    expect(otherHead, 'a row naming this head cannot rescue metadata for another head').toMatchObject({ qualified: false });
  });

  it('CASUALTY: two summary comments each carrying a block is duplicated metadata, and holds', () => {
    const receipt = receiptFor(pullRequest({ comments: [summary(), { ...summary(), id: 'second-summary' }] }));
    expect(receipt).toMatchObject({ qualified: false, reviewEvidence: null });
  });

  it('CASUALTY: exact completed metadata plus a live P0/P1 on ANY result surface holds', () => {
    const cases = {
      'unresolved review thread': { threads: [findingThread({ isResolved: false })] },
      'resolved same-head review thread': { threads: [findingThread({ isResolved: true })] },
      'finding in a review body': { reviews: [codexReview(HEAD, at(5), { body: '**P1 Badge** finding in the body' })] },
      'CHANGES_REQUESTED review': { reviews: [codexReview(HEAD, at(5), { state: 'CHANGES_REQUESTED' })] },
      'finding issue comment': { extraComments: [{ ...cleanResult(FOOTER), body: `**P1 Badge** finding\n\n**Reviewed commit:** \`${FOOTER}\`` }] },
    };
    for (const [label, { threads = [], reviews = [], extraComments = [] }] of Object.entries(cases)) {
      const receipt = receiptFor(pullRequest({ threads, reviews, comments: [summary(), ...extraComments] }));
      expect({ label, qualified: receipt.qualified, blocked: receipt.findingCount > 0 || receipt.reasons.length > 0 })
        .toEqual({ label, qualified: false, blocked: true });
    }
  });

  it('CASUALTY: exact completed metadata on an incomplete comment read holds', () => {
    const receipt = receiptFor(pullRequest({ comments: [summary()], commentsTruncated: true }));
    expect(receipt.qualified).toBe(false);
    expect(receipt.reasons).toContain('issue_comments_incomplete');
  });

  it('CONTROL: exact trusted completed metadata, every surface complete, zero live P0/P1 qualifies', () => {
    const receipt = receiptFor(pullRequest({ comments: [cleanResult(FOOTER), summary()] }));
    expect(receipt).toMatchObject({
      qualified: true, reviewEvidence: 'codex_summary_metadata', reviewedSha: HEAD, findingCount: 0, reviewStatus: 'completed',
    });
  });

  it('CONTROL: metadata that omits the optional repository and PR fields still binds the exact head', () => {
    const receipt = receiptFor(pullRequest({
      comments: [summary({ raw: JSON.stringify({ headSha: HEAD, status: 'completed' }) })],
    }));
    expect(receipt).toMatchObject({ qualified: true, reviewEvidence: 'codex_summary_metadata' });
  });

  it('CONTROL: colliding head B qualifies only on metadata naming B itself', () => {
    const receipt = receiptFor(pullRequest({ head: COLLIDER, comments: [summary({ meta: { headSha: COLLIDER } })] }));
    expect(receipt).toMatchObject({ qualified: true, reviewEvidence: 'codex_summary_metadata', reviewedSha: COLLIDER });
  });

  it('CONTROL: an exact review object `commit.oid === head` still qualifies', () => {
    const receipt = receiptFor(pullRequest({ reviews: [codexReview(HEAD, at(25))] }));
    expect(receipt).toMatchObject({ qualified: true, reviewEvidence: 'review_object', reviewedSha: HEAD, findingCount: 0 });
  });

  describe('the live reader issues only the review query', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('no abbreviation resolution, no branch chronology, no extra reads', async () => {
      const requests = [];
      vi.stubGlobal('fetch', async (url, init) => {
        requests.push({ path: String(url).replace('https://api.github.com', ''), query: JSON.parse(init?.body ?? '{}').query ?? null });
        return { ok: true, status: 200, json: async () => ({ data: { repository: { pullRequest: {
          number: PR, headRefOid: HEAD,
          comments: { nodes: [cleanResult(FOOTER), summary()], pageInfo: { hasPreviousPage: false } },
        } } } }) };
      });
      await readPullRequest({ repository: REPO, number: PR, token: 't' });

      expect(requests).toEqual([{ path: '/graphql', query: PULL_REQUEST_REVIEW_QUERY }]);
      expect(PULL_REQUEST_REVIEW_QUERY).not.toMatch(/activity|object\(expression|headRefName|headRepository/);
    });
  });
});
