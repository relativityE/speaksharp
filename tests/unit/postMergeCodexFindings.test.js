/**
 * #1430 fix-forward — the three Codex P1s that landed on #1430 AFTER it merged, and #1438's follow-ups.
 *
 *   `3991325303` — executable control files were not "substantive", so a control-only PR could never qualify.
 *   `3991388525` — a RESOLVED same-head P0/P1 stopped counting, so resolving a blocker bypassed re-review.
 *   `3991388531`, `3992215898`, `3992367735`, `3992467525` — every binding that read generated comment TEXT
 *                  (a prefix, abbreviation resolution, any full SHA, the designated field) was steerable.
 *   PM DECISION `5639300027` (option C) — completion binds only through a review object's full `commit.oid` or
 *                  Codex's structured review-summary system metadata, and never clears a P0/P1.
 *   `3992603040` (PM DECISION `5639821873`) — the metadata is the SECURITY review's; the code review must complete.
 *   `3992907765` (PM RETURN `5639978861`) — a completed Code Review row for head A must not vouch for head B: both
 *                  automatic reviews must complete for THIS head's Ready trigger, bound by GitHub's lifecycle record.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateReviewQualification, isSubstantiveImplementationFile } from '../../scripts/review-qualification.mjs';
import {
  buildReviewReceipt, HEAD_REF_HISTORY_PAGE_SIZE, PULL_REQUEST_REVIEW_QUERY, readPullRequest,
} from '../../scripts/collect-review-qualification.mjs';

/** The reviewed head, a different commit ground to share its footer, and unrelated heads. */
const HEAD = `0cb6b1ebaa${'b'.repeat(30)}`;
const COLLIDER = `0cb6b1ebaa${'c'.repeat(30)}`;
const FOOTER = HEAD.slice(0, 10);
const OLDER_HEAD = 'e'.repeat(40);
const OTHER_HEAD = 'f'.repeat(40);
const REPO = 'relativityE/speaksharp';
const PR = 1500;
const bot = { login: 'chatgpt-codex-connector' };
const human = { login: 'relativityE' };
const at = (minute) => `2026-09-11T16:${String(minute).padStart(2, '0')}:00Z`;
/** The PR was marked ready at minute 20; by default the branch last moved at minute 10 and both reviews finished at 24. */
const READY_AT = at(20);

/** Codex's clean result comment. Its text is never identity; `footer` is what its marker prints. */
const cleanResult = (footer, createdAt = at(25), author = bot) => ({
  id: `clean-${footer}-${createdAt}`, author, authorAssociation: 'NONE', createdAt,
  body: `Codex Review: Didn't find any major issues. Swish!\n\n**Reviewed commit:** \`${footer}\``,
});

/** A summary table row as Codex renders it. `commit` is its abbreviated DISPLAY commit, never identity. */
const completed = (when = at(24)) => `✅ **Completed** <relative-time datetime="${when}">${when}</relative-time>`;
const reviewRow = (label, { status = completed(), commit = HEAD.slice(0, 7), trigger = 'Draft marked ready' } = {}) =>
  `| ${label} | ${status} | \`${commit}\` | ${trigger} |`;
const codeRow = (options) => reviewRow('📝 **Code Review**', options);
const securityRow = (options) => reviewRow('🔒 **Security Review**', options);

/** Codex's review-summary comment, carrying the structured system metadata option C binds through. */
const summaryBody = ({ meta = {}, raw = null, marker = true, blocks = 1, codeRows = null, securityRows = null } = {}) => {
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
    ...(codeRows ?? [codeRow()]),
    ...(securityRows ?? [securityRow()]),
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

/**
 * A pull request as `readPullRequest()` returns it, including GitHub's lifecycle record: the Ready events on the
 * timeline and the branch's moves from the activity log (full SHAs). `moves` defaults to "the head was pushed at 10".
 */
const pullRequest = ({
  head = HEAD, reviews = [], threads = [], comments = [], commentsTruncated = false,
  files = ['scripts/review-qualification.mjs'],
  readyEvents, noTimeline = false, moves, historyComplete = true, noHistory = false,
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
  ...(noTimeline ? {} : { timelineItems: { nodes: (readyEvents ?? [READY_AT]).map((createdAt) => ({ createdAt })) } }),
  headRefHistory: noHistory ? null : { complete: historyComplete, moves: moves ?? [{ after: head, timestamp: at(10) }] },
});
const receiptFor = (pr) => buildReviewReceipt({ pullRequest: pr, expectedHeadSha: pr.headRefOid });
const holds = (label, pr) => {
  const receipt = receiptFor(pr);
  expect({ label, qualified: receipt.qualified, evidence: receipt.reviewEvidence }).toEqual({ label, qualified: false, evidence: null });
};

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
    const receipt = receiptFor(pullRequest({ threads: [findingThread({ isResolved: true })], comments: [summary()] }));
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

describe('#1438 exact-head completion — a review object, or trusted summary metadata bound to this head\'s Ready trigger', () => {
  it('CASUALTY: a clean comment with only the normal 10-character footer and no system metadata holds', () => {
    const receipt = receiptFor(pullRequest({ comments: [cleanResult(FOOTER)] }));
    expect(receipt).toMatchObject({ qualified: false, reviewEvidence: null });
    expect(receipt.reasons).toContain('review_not_completed:missing');
  });

  it('CASUALTY: a full SHA in prose, a requester-steered marker, or a human-authored attestation holds', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    const cases = {
      'full head in prose': { ...cleanResult(FOOTER), body: `Codex Review: Didn't find any major issues at ${HEAD}.` },
      'Codex comment with a full designated marker (`3992467525`)': cleanResult(HEAD),
      'human comment with a full marker': cleanResult(HEAD, at(25), human),
      'human-authored copy of the summary metadata': summary({}, human),
    };
    for (const [label, comment] of Object.entries(cases)) holds(label, pullRequest({ comments: [comment] }));
  });

  it("CASUALTY (`3992467525`): review A's comment printing colliding B in the designated field does not qualify B", () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    holds('A prints B', pullRequest({ head: COLLIDER, comments: [cleanResult(COLLIDER), summary({ meta: { headSha: HEAD } })] }));
  });

  it('CASUALTY: metadata for another head, repository or PR, malformed, duplicated, or not completed holds', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
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
      'no summary marker': { marker: false },
    };
    for (const [label, options] of Object.entries(cases)) holds(label, pullRequest({ comments: [summary(options)] }));
  });

  it('CASUALTY: two summary comments each carrying a block is duplicated metadata, and holds', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    holds('two summaries', pullRequest({ comments: [summary(), { ...summary(), id: 'second-summary' }] }));
  });

  it('CASUALTY (`3992603040`): a Code Review row that did not complete holds', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    const cases = {
      failed: [codeRow({ status: '❌ **Failed**' })],
      cancelled: [codeRow({ status: '⛔ **Cancelled**' })],
      running: [codeRow({ status: '🔄 **Running** since 2026-09-11T16:21:00Z' })],
      'unknown state': [codeRow({ status: '❔ **Queued**' })],
      missing: [],
      duplicated: [codeRow(), codeRow()],
      'completed and failed rows together': [codeRow(), codeRow({ status: '❌ **Failed**' })],
      'malformed label': [`| **Code Review** | ${completed()} | \`${HEAD.slice(0, 7)}\` | Draft marked ready |`],
      'malformed row (no status cell)': ['| 📝 **Code Review** |'],
      'Completed only in a later cell': [`| 📝 **Code Review** | ❌ **Failed** | ${completed()} | Draft marked ready |`],
      'Completed with no readable time': [codeRow({ status: '✅ **Completed**' })],
    };
    for (const [label, codeRows] of Object.entries(cases)) holds(label, pullRequest({ comments: [summary({ codeRows })] }));
  });

  it('CASUALTY: a Security Review row that is not a completed row of the same trigger holds', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    const cases = {
      missing: [],
      running: [securityRow({ status: '🔄 **Running** since 2026-09-11T16:21:00Z' })],
      duplicated: [securityRow(), securityRow()],
      'PR-opened trigger': [securityRow({ trigger: 'PR opened' })],
      'display commit for another head': [securityRow({ commit: 'fffffff' })],
    };
    for (const [label, securityRows] of Object.entries(cases)) holds(label, pullRequest({ comments: [summary({ securityRows })] }));
  });

  it('CASUALTY (`3992907765`): a stale Completed Code Review row for head A beside exact security metadata for head B holds', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    holds('stale code row for A', pullRequest({
      head: OTHER_HEAD,
      moves: [{ after: OTHER_HEAD, timestamp: at(10) }],
      comments: [summary({
        meta: { headSha: OTHER_HEAD },
        codeRows: [codeRow({ commit: OLDER_HEAD.slice(0, 7) })],
        securityRows: [securityRow({ commit: OTHER_HEAD.slice(0, 7) })],
      })],
    }));
    // The control that used to qualify: a Completed row whose display commit is not this head.
    holds('display commit deadbee', pullRequest({ comments: [summary({ codeRows: [codeRow({ commit: 'deadbee' })] })] }));
  });

  it('CASUALTY (`3992907765`): prefix-colliding A was reviewed, then B was pushed after the Ready event — B does not qualify', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    holds('collider pushed after Ready', pullRequest({
      head: COLLIDER,
      moves: [{ after: HEAD, timestamp: at(10) }, { after: COLLIDER, timestamp: at(22) }],
      comments: [summary({ meta: { headSha: COLLIDER } })],
    }));
  });

  it('CASUALTY: ANY branch move after the Ready event holds — away-and-back and a re-push of the same head included', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    const cases = {
      'away and back': [{ after: HEAD, timestamp: at(10) }, { after: OLDER_HEAD, timestamp: at(21) }, { after: HEAD, timestamp: at(22) }],
      're-push of the same head after Ready': [{ after: HEAD, timestamp: at(10) }, { after: HEAD, timestamp: at(22) }],
    };
    for (const [label, moves] of Object.entries(cases)) holds(label, pullRequest({ moves, comments: [summary()] }));
  });

  it('CASUALTY: completions from a manual request, or rows completed before the Ready event, do not use this fallback', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    holds('manual-request code row', pullRequest({ comments: [summary({ codeRows: [codeRow({ trigger: 'Manual request' })] })] }));
    holds('code row completed before Ready', pullRequest({ comments: [summary({ codeRows: [codeRow({ status: completed(at(15)) })] })] }));
    holds('security row completed before Ready', pullRequest({ comments: [summary({ securityRows: [securityRow({ status: completed(at(15)) })] })] }));
    holds('an earlier Ready event only', pullRequest({ readyEvents: [at(5), at(25)], comments: [summary()] }));
  });

  it('CASUALTY: missing, truncated, ambiguous or unreadable lifecycle evidence holds', () => {
    // Asserts through `holds()`; declared here so the lint rule and the runner both see it.
    expect.hasAssertions();
    const cases = {
      'no timeline read': { noTimeline: true },
      'no Ready event': { readyEvents: [] },
      'unreadable Ready time': { readyEvents: ['not-a-time'] },
      'no branch history': { noHistory: true },
      'branch history truncated': { historyComplete: false },
      'empty branch history': { moves: [] },
      'another commit was the head at Ready': { moves: [{ after: OLDER_HEAD, timestamp: at(10) }] },
      'head only pushed after Ready': { moves: [{ after: HEAD, timestamp: at(22) }] },
      'ambiguous head at Ready': { moves: [{ after: HEAD, timestamp: at(10) }, { after: OLDER_HEAD, timestamp: at(10) }] },
      'unreadable move time': { moves: [{ after: HEAD, timestamp: 'not-a-time' }] },
    };
    for (const [label, lifecycle] of Object.entries(cases)) holds(label, pullRequest({ ...lifecycle, comments: [summary()] }));
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

  it('CONTROL: exact B was the branch head before Ready, never moved after, both rows completed for that Ready trigger, metadata names full B, zero P0/P1 — qualifies', () => {
    const receipt = receiptFor(pullRequest({
      head: COLLIDER,
      moves: [{ after: HEAD, timestamp: at(5) }, { after: COLLIDER, timestamp: at(10) }],
      comments: [cleanResult(FOOTER), summary({ meta: { headSha: COLLIDER } })],
    }));
    expect(receipt).toMatchObject({
      qualified: true, reviewEvidence: 'codex_summary_metadata', reviewedSha: COLLIDER, findingCount: 0, reviewStatus: 'completed',
    });
    expect(receiptFor(pullRequest({ comments: [summary()] }))).toMatchObject({ qualified: true, reviewEvidence: 'codex_summary_metadata' });
  });

  it('CONTROL: metadata that omits the optional repository and PR fields still binds the exact head', () => {
    const receipt = receiptFor(pullRequest({ comments: [summary({ raw: JSON.stringify({ headSha: HEAD, status: 'completed' }) })] }));
    expect(receipt).toMatchObject({ qualified: true, reviewEvidence: 'codex_summary_metadata' });
  });

  it('CONTROL: an exact review object `commit.oid === head` still qualifies, without any lifecycle evidence', () => {
    const receipt = receiptFor(pullRequest({ reviews: [codexReview(HEAD, at(25))], noTimeline: true, noHistory: true }));
    expect(receipt).toMatchObject({ qualified: true, reviewEvidence: 'review_object', reviewedSha: HEAD, findingCount: 0 });
  });

  it('the live read selects the head branch identity and the Ready events', () => {
    expect(PULL_REQUEST_REVIEW_QUERY).toContain('headRefOid headRefName headRepository{nameWithOwner}');
    expect(PULL_REQUEST_REVIEW_QUERY).toContain('timelineItems(last:20,itemTypes:[READY_FOR_REVIEW_EVENT]){nodes{... on ReadyForReviewEvent{createdAt}}}');
  });

  describe('the live reader supplies the branch moves from the activity log', () => {
    afterEach(() => vi.unstubAllGlobals());

    const stubGithub = ({ activityStatus = 200, activity }) => {
      const requests = [];
      vi.stubGlobal('fetch', async (url, init) => {
        const path = String(url).replace('https://api.github.com', '');
        requests.push({ path, query: JSON.parse(init?.body ?? '{}').query ?? null });
        const respond = (status, json) => ({ ok: status === 200, status, json: async () => json });
        if (path.includes('/activity?')) return respond(activityStatus, activity);
        return respond(200, { data: { repository: { pullRequest: {
          number: PR, headRefOid: HEAD, headRefName: 'fix/branch-name', headRepository: { nameWithOwner: REPO },
          comments: { nodes: [summary()], pageInfo: { hasPreviousPage: false } },
        } } } });
      });
      return requests;
    };
    const read = () => readPullRequest({ repository: REPO, number: PR, token: 't' });

    it('reads the review query and the head branch activity; a merge-time deletion is not a move', async () => {
      const requests = stubGithub({
        activity: [
          { activity_type: 'branch_deletion', after: '0'.repeat(40), timestamp: at(40) },
          { activity_type: 'push', after: HEAD, timestamp: at(10) },
          { activity_type: 'branch_creation', after: OLDER_HEAD, timestamp: at(1) },
        ],
      });
      const pr = await read();
      expect(requests.filter((r) => r.query !== null).every((r) => r.query === PULL_REQUEST_REVIEW_QUERY)).toBe(true);
      expect(requests.map((r) => r.path))
        .toContain(`/repos/${REPO}/activity?ref=refs%2Fheads%2Ffix%2Fbranch-name&per_page=${HEAD_REF_HISTORY_PAGE_SIZE}`);
      expect(pr.headRefHistory).toEqual({
        complete: true,
        moves: [{ after: HEAD, timestamp: at(10) }, { after: OLDER_HEAD, timestamp: at(1) }],
      });
    });

    it('a full page is incomplete history, and an unreadable log is no history', async () => {
      stubGithub({ activity: Array.from({ length: HEAD_REF_HISTORY_PAGE_SIZE }, () => ({ activity_type: 'push', after: HEAD, timestamp: at(10) })) });
      expect((await read()).headRefHistory.complete).toBe(false);
      vi.unstubAllGlobals();
      stubGithub({ activityStatus: 403, activity: { message: 'Resource not accessible' } });
      expect((await read()).headRefHistory).toBeNull();
    });
  });
});
