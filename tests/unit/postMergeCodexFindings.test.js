/**
 * #1430 fix-forward — the three Codex P1s that landed on #1430 AFTER it merged, and #1438's own follow-up.
 *
 * Marking #1430 ready triggered Codex's automatic code review and security review against the merged head.
 * Each group below reproduces one finding, then pins the behaviour that must survive the fix with a
 * positive control.
 *
 *   `3991325303` — executable control files were not "substantive", so a control-only PR could never qualify.
 *   `3991388525` — a RESOLVED same-head P0/P1 stopped counting, so resolving a blocker bypassed re-review.
 *   `3991388531` — a clean result bound to the head by an abbreviated SHA prefix alone, so a head ground to
 *                  share that prefix reused an older clean result.
 *   `3992215898` — (#1438, PM RETURN `5638958869`) the first binding trusted GitHub's CURRENT abbreviation
 *                  resolution plus branch-move chronology, both of which a stale result can satisfy. Only an
 *                  immutable full identity is authority now.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateReviewQualification, isSubstantiveImplementationFile } from '../../scripts/review-qualification.mjs';
import {
  buildReviewReceipt, PULL_REQUEST_REVIEW_QUERY, readPullRequest,
} from '../../scripts/collect-review-qualification.mjs';

/** The reviewed head, and a different commit ground to share its 10-character footer. */
const HEAD = `0cb6b1ebaa${'b'.repeat(30)}`;
const COLLIDER = `0cb6b1ebaa${'c'.repeat(30)}`;
const FOOTER = HEAD.slice(0, 10);
const OLDER_HEAD = 'e'.repeat(40);
const bot = { login: 'chatgpt-codex-connector' };
const at = (minute) => `2026-09-11T16:${String(minute).padStart(2, '0')}:00Z`;

/** Codex's clean result. `footer` is what the comment names: the full SHA by default, or Codex's usual abbreviation. */
const cleanResult = (sha, createdAt, { footer = sha } = {}) => ({
  id: `clean-${sha.slice(0, 12)}-${createdAt}`, author: bot, authorAssociation: 'NONE', createdAt,
  body: `Codex Review: Didn't find any major issues. Swish!\n\n**Reviewed commit:** \`${footer}\``,
});
const codexReview = (sha, submittedAt, state = 'COMMENTED') => ({
  author: bot, state, commit: { oid: sha }, submittedAt,
  body: '### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.',
});
const findingThread = ({ sha = HEAD, createdAt, isResolved, reviewState = 'COMMENTED' }) => ({
  isResolved,
  comments: {
    nodes: [{
      author: bot, createdAt, body: '**P1 Badge** A release finding',
      commit: { oid: sha }, originalCommit: { oid: sha },
      pullRequestReview: { state: reviewState, commit: { oid: sha } },
    }],
    pageInfo: { hasPreviousPage: false },
  },
});

/** A pull request as `readPullRequest()` returns it. `extra` adds fields the collector must NOT consult. */
const pullRequest = ({
  head = HEAD, reviews = [], threads = [], comments = [], files = ['scripts/review-qualification.mjs'], extra = {},
} = {}) => ({
  number: 1500,
  headRefOid: head,
  baseRefName: 'main',
  baseRefOid: 'd'.repeat(40),
  baseRepository: { nameWithOwner: 'relativityE/speaksharp' },
  files: { nodes: files.map((path) => ({ path })), pageInfo: { hasNextPage: false } },
  reviews: { nodes: reviews, pageInfo: { hasPreviousPage: false } },
  reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false } },
  comments: { nodes: comments, pageInfo: { hasPreviousPage: false } },
  ...extra,
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

describe('#1430 fix-forward `3991388525` — resolving a same-head blocker does not clear it without a clean re-review', () => {
  it('CASUALTY: a RESOLVED same-head Codex P1 with no later clean re-review still blocks', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5))],
      threads: [findingThread({ createdAt: at(5), isResolved: true })],
    }));
    expect(receipt.findingCount).toBe(1);
    expect(receipt.qualified).toBe(false);
  });

  it('CASUALTY: a clean result posted BEFORE the finding does not clear it', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5))],
      threads: [findingThread({ createdAt: at(5), isResolved: true })],
      comments: [cleanResult(HEAD, at(3))],
    }));
    expect(receipt.findingCount).toBe(1);
    expect(receipt.qualified).toBe(false);
  });

  it('CASUALTY: a resolved finding whose time is unknown is not assumed older than the clean result', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5))],
      threads: [findingThread({ createdAt: undefined, isResolved: true })],
      comments: [cleanResult(HEAD, at(9))],
    }));
    expect(receipt.findingCount).toBe(1);
  });

  it('CASUALTY: a later clean result that names the head only by abbreviation does not clear it', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5))],
      threads: [findingThread({ createdAt: at(5), isResolved: true })],
      comments: [cleanResult(HEAD, at(9), { footer: FOOTER })],
    }));
    expect(receipt.findingCount).toBe(1);
  });

  it('CONTROL: a LATER clean Codex result bound to the same head clears the resolved finding', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5))],
      threads: [findingThread({ createdAt: at(5), isResolved: true })],
      comments: [cleanResult(HEAD, at(9))],
    }));
    expect(receipt.findingCount).toBe(0);
    expect(receipt.qualified).toBe(true);
  });

  it('CONTROL: a resolved finding inside an authorized DISMISSED review does not block', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5), 'DISMISSED')],
      threads: [findingThread({ createdAt: at(5), isResolved: true, reviewState: 'DISMISSED' })],
      comments: [cleanResult(HEAD, at(3))],
    }));
    expect(receipt.findingCount).toBe(0);
    expect(receipt.qualified).toBe(true);
  });

  it('CONTROL: an UNRESOLVED same-head P1 still blocks, even after a later clean result or a dismissal', () => {
    for (const reviewState of ['COMMENTED', 'DISMISSED']) {
      const receipt = receiptFor(pullRequest({
        reviews: [codexReview(HEAD, at(5))],
        threads: [findingThread({ createdAt: at(5), isResolved: false, reviewState })],
        comments: [cleanResult(HEAD, at(9))],
      }));
      expect({ reviewState, findingCount: receipt.findingCount }).toEqual({ reviewState, findingCount: 1 });
    }
  });

  it('CONTROL: a resolved P1 from an OLDER head is historical and does not block the new head', () => {
    const receipt = receiptFor(pullRequest({
      threads: [findingThread({ sha: OLDER_HEAD, createdAt: at(1), isResolved: true })],
      comments: [cleanResult(HEAD, at(9))],
    }));
    expect(receipt.findingCount).toBe(0);
    expect(receipt.qualified).toBe(true);
  });

  it("the live read selects what this needs: each thread comment's time and its review's state", () => {
    expect(PULL_REQUEST_REVIEW_QUERY).toMatch(/reviewThreads\(first:100\)\{nodes\{isResolved comments\(last:100\)\{nodes\{createdAt /);
    expect(PULL_REQUEST_REVIEW_QUERY).toContain('pullRequestReview{state commit{oid}}');
  });
});

describe('#1430 fix-forward `3991388531` + #1438 `3992215898` — clean authority is an immutable full commit identity', () => {
  it('CASUALTY: stale review A arriving after colliding head B never qualifies B', () => {
    for (const footer of [FOOTER, HEAD]) {
      const receipt = receiptFor(pullRequest({ head: COLLIDER, comments: [cleanResult(HEAD, at(25), { footer })] }));
      expect({ footer, evidence: receipt.reviewEvidence, qualified: receipt.qualified })
        .toEqual({ footer, evidence: null, qualified: false });
    }
  });

  it("CASUALTY: A's later disappearance changes nothing — the facts the previous binding trusted are not consulted", () => {
    /**
     * Codex's `3992215898` sequence after garbage collection: GitHub now resolves the footer uniquely to B, and
     * the branch's last move to B precedes the comment. The previous binding qualified B on exactly these facts.
     */
    const receipt = receiptFor(pullRequest({
      head: COLLIDER,
      comments: [cleanResult(HEAD, at(25), { footer: FOOTER })],
      extra: {
        resolvedAbbreviations: { [FOOTER]: COLLIDER },
        headRefMove: { after: COLLIDER, timestamp: at(20) },
        headRefHistory: { complete: true, moves: [{ after: COLLIDER, timestamp: at(20) }] },
      },
    }));
    expect(receipt.reviewEvidence).toBeNull();
    expect(receipt.qualified).toBe(false);
  });

  it('CASUALTY: an ABBREVIATED clean result for the current head does not qualify it', () => {
    const receipt = receiptFor(pullRequest({ comments: [cleanResult(HEAD, at(25), { footer: FOOTER })] }));
    expect(receipt.reviewEvidence).toBeNull();
    expect(receipt.reasons).toContain('review_not_completed:missing');
    expect(receipt.qualified).toBe(false);
  });

  it('CONTROL: a trusted clean result naming the exact 40-character head qualifies — in the footer or a follow-up confirmation', () => {
    const footerResult = receiptFor(pullRequest({ comments: [cleanResult(HEAD, at(25))] }));
    expect(footerResult).toMatchObject({ qualified: true, reviewEvidence: 'clean_result_comment', reviewedSha: HEAD });

    const confirmation = receiptFor(pullRequest({
      comments: [{
        id: 'confirm', author: bot, authorAssociation: 'NONE', createdAt: at(30),
        body: `Codex Review: Didn't find any major issues at exact head ${HEAD}.`,
      }],
    }));
    expect(confirmation).toMatchObject({ qualified: true, reviewEvidence: 'clean_result_comment' });
  });

  it('CONTROL: a Codex review object bound by its full commit.oid qualifies', () => {
    const receipt = receiptFor(pullRequest({ reviews: [codexReview(HEAD, at(25))] }));
    expect(receipt).toMatchObject({ qualified: true, reviewEvidence: 'review_object', reviewedSha: HEAD, findingCount: 0 });
  });

  it('CASUALTY: malformed or missing full identity holds', () => {
    const cases = {
      'no SHA at all': "Codex Review: Didn't find any major issues. Swish!",
      '39 hex': `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${HEAD.slice(0, 39)}\``,
      '41 hex': `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${HEAD}0\``,
      "another commit's full SHA": `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${COLLIDER}\``,
      'two different full SHAs': `Codex Review: Didn't find any major issues for ${HEAD} and ${COLLIDER}.`,
    };
    for (const [label, body] of Object.entries(cases)) {
      const receipt = receiptFor(pullRequest({
        comments: [{ id: label, author: bot, authorAssociation: 'NONE', createdAt: at(25), body }],
      }));
      expect({ label, qualified: receipt.qualified, evidence: receipt.reviewEvidence })
        .toEqual({ label, qualified: false, evidence: null });
    }
  });

  it('CASUALTY: a HUMAN naming the full head in the same words is still not authority', () => {
    const receipt = receiptFor(pullRequest({
      comments: [{ ...cleanResult(HEAD, at(25)), author: { login: 'relativityE' }, authorAssociation: 'OWNER' }],
    }));
    expect(receipt.qualified).toBe(false);
  });

  describe('the live reader reads review evidence only — no abbreviation resolution, no branch chronology', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('issues exactly the review query and nothing else', async () => {
      const requests = [];
      vi.stubGlobal('fetch', async (url, init) => {
        requests.push({ path: String(url).replace('https://api.github.com', ''), query: JSON.parse(init?.body ?? '{}').query ?? null });
        return { ok: true, status: 200, json: async () => ({ data: { repository: { pullRequest: {
          number: 1500, headRefOid: HEAD,
          comments: { nodes: [cleanResult(HEAD, at(9), { footer: FOOTER })], pageInfo: { hasPreviousPage: false } },
        } } } }) };
      });
      await readPullRequest({ repository: 'relativityE/speaksharp', number: 1500, token: 't' });

      expect(requests).toEqual([{ path: '/graphql', query: PULL_REQUEST_REVIEW_QUERY }]);
      expect(PULL_REQUEST_REVIEW_QUERY).not.toMatch(/activity|object\(expression|headRefName|headRepository/);
    });
  });
});
