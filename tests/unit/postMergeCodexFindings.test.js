/**
 * #1430 fix-forward — the three Codex P1s that landed on #1430 AFTER it merged.
 *
 * Marking #1430 ready triggered Codex's automatic code review and security review against the merged head.
 * Each group below reproduces one finding against `main@cc91f20698`, then pins the behaviour that must
 * survive the fix with a positive control.
 *
 *   `3991325303` — executable control files were not "substantive", so a control-only PR could never qualify.
 *   `3991388525` — a RESOLVED same-head P0/P1 stopped counting, so resolving a blocker bypassed re-review.
 *   `3991388531` — a clean result bound to the head by an abbreviated SHA prefix alone, so a head ground to
 *                  share that prefix reused an older clean result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateReviewQualification, isSubstantiveImplementationFile } from '../../scripts/review-qualification.mjs';
import {
  buildReviewReceipt, COMMIT_ABBREVIATION_QUERY, PULL_REQUEST_REVIEW_QUERY, readPullRequest,
} from '../../scripts/collect-review-qualification.mjs';

/** The reviewed head, and a different commit ground to share its 10-character footer. */
const HEAD = `0cb6b1ebaa${'b'.repeat(30)}`;
const COLLIDER = `0cb6b1ebaa${'c'.repeat(30)}`;
const FOOTER = HEAD.slice(0, 10);
const OLDER_HEAD = 'e'.repeat(40);
const bot = { login: 'chatgpt-codex-connector' };
const at = (minute) => `2026-09-11T16:${String(minute).padStart(2, '0')}:00Z`;

const cleanResult = (sha, createdAt) => ({
  id: `clean-${sha.slice(0, 12)}-${createdAt}`, author: bot, authorAssociation: 'NONE', createdAt,
  body: `Codex Review: Didn't find any major issues. Swish!\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
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

/**
 * A pull request as `readPullRequest()` returns it. `movedAt`/`movedTo` are the PR branch's last move in the
 * activity log; `resolvesTo` is what GitHub resolves the footer abbreviation to (`null` = ambiguous/unknown).
 */
const pullRequest = ({
  head = HEAD, movedAt = at(0), movedTo = head, resolvesTo = head, reviews = [], threads = [], comments = [],
  files = ['scripts/review-qualification.mjs'],
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
  headRefMove: movedAt === null ? null : { after: movedTo, timestamp: movedAt },
  resolvedAbbreviations: { [FOOTER]: resolvesTo },
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

  it('CASUALTY: a later clean result that does not bind to this head does not clear it', () => {
    const receipt = receiptFor(pullRequest({
      reviews: [codexReview(HEAD, at(5))],
      threads: [findingThread({ createdAt: at(5), isResolved: true })],
      comments: [cleanResult(HEAD, at(9))],
      resolvesTo: null,
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

describe('#1430 fix-forward `3991388531` — a clean result binds to the exact head, not an abbreviated prefix', () => {
  it('CASUALTY: a stale clean result cannot qualify a later head ground to share its footer (both commits exist)', () => {
    const receipt = receiptFor(pullRequest({
      head: COLLIDER, movedAt: at(20), resolvesTo: null,
      comments: [cleanResult(HEAD, at(3))],
    }));
    expect(receipt.reviewEvidence).toBeNull();
    expect(receipt.qualified).toBe(false);
  });

  it('CASUALTY: nor once the footer resolves uniquely again — the result predates the head reaching the branch', () => {
    const receipt = receiptFor(pullRequest({
      head: COLLIDER, movedAt: at(20), resolvesTo: COLLIDER,
      comments: [cleanResult(HEAD, at(3))],
    }));
    expect(receipt.reviewEvidence).toBeNull();
    expect(receipt.qualified).toBe(false);
  });

  it('CASUALTY: nor a result for the older commit that lands after the collider was pushed (ambiguous footer)', () => {
    const receipt = receiptFor(pullRequest({
      head: COLLIDER, movedAt: at(20), resolvesTo: null,
      comments: [cleanResult(HEAD, at(25))],
    }));
    expect(receipt.reviewEvidence).toBeNull();
    expect(receipt.qualified).toBe(false);
  });

  it('CONTROL: a clean result posted after the head reached the branch, whose footer resolves to it, qualifies', () => {
    const receipt = receiptFor(pullRequest({
      head: COLLIDER, movedAt: at(20), resolvesTo: COLLIDER,
      comments: [cleanResult(COLLIDER, at(25))],
    }));
    expect(receipt.reviewEvidence).toBe('clean_result_comment');
    expect(receipt.qualified).toBe(true);
  });

  it('CASUALTY: with no readable branch move, or a move to a different commit, a clean result binds nothing', () => {
    for (const branch of [{ movedAt: null }, { movedTo: OLDER_HEAD }, { movedAt: 'not-a-time' }]) {
      const receipt = receiptFor(pullRequest({ ...branch, comments: [cleanResult(HEAD, at(25))] }));
      expect({ branch, qualified: receipt.qualified }).toEqual({ branch, qualified: false });
    }
  });

  describe('the live reader supplies both facts from GitHub', () => {
    afterEach(() => vi.unstubAllGlobals());

    const stubGithub = ({ activityStatus = 200, activity, objectFor }) => {
      const requests = [];
      vi.stubGlobal('fetch', async (url, init) => {
        const path = String(url).replace('https://api.github.com', '');
        const body = JSON.parse(init?.body ?? '{}');
        requests.push({ path, query: body.query ?? null, variables: body.variables ?? null });
        const respond = (status, json) => ({ ok: status === 200, status, json: async () => json });
        if (path.includes('/activity?')) return respond(activityStatus, activity);
        if (body.query === COMMIT_ABBREVIATION_QUERY) {
          return respond(200, { data: { repository: { object: objectFor(body.variables.expression) } } });
        }
        return respond(200, { data: { repository: { pullRequest: {
          number: 1500, headRefOid: HEAD, headRefName: 'fix/branch-name', headRepository: { nameWithOwner: 'relativityE/speaksharp' },
          comments: {
            nodes: [cleanResult(HEAD, at(9)), cleanResult(OLDER_HEAD, at(2))],
            pageInfo: { hasPreviousPage: false },
          },
        } } } });
      });
      return requests;
    };

    it('reads the head branch activity and resolves only the footer that abbreviates the head', async () => {
      const requests = stubGithub({
        activity: [
          { activity_type: 'branch_deletion', after: '0'.repeat(40), timestamp: at(30) },
          { activity_type: 'push', after: HEAD, timestamp: at(4) },
          { activity_type: 'push', after: OLDER_HEAD, timestamp: at(1) },
        ],
        objectFor: (expression) => (expression === FOOTER ? { oid: HEAD } : null),
      });
      const pr = await readPullRequest({ repository: 'relativityE/speaksharp', number: 1500, token: 't' });

      expect(requests.map((r) => r.path)).toContain('/repos/relativityE/speaksharp/activity?ref=refs%2Fheads%2Ffix%2Fbranch-name&per_page=10');
      expect(requests.filter((r) => r.query === COMMIT_ABBREVIATION_QUERY).map((r) => r.variables))
        .toEqual([{ owner: 'relativityE', name: 'speaksharp', expression: FOOTER }]);
      expect(pr.headRefMove).toEqual({ after: HEAD, timestamp: at(4) });
      expect(pr.resolvedAbbreviations).toEqual({ [FOOTER]: HEAD });
      expect(PULL_REQUEST_REVIEW_QUERY).toContain('headRefOid headRefName headRepository{nameWithOwner}');
    });

    it('an ambiguous footer resolves to null, and an unreadable activity log is no move at all', async () => {
      stubGithub({ activityStatus: 403, activity: { message: 'Resource not accessible' }, objectFor: () => null });
      const pr = await readPullRequest({ repository: 'relativityE/speaksharp', number: 1500, token: 't' });

      expect(pr.headRefMove).toBeNull();
      expect(pr.resolvedAbbreviations).toEqual({ [FOOTER]: null });
    });
  });
});
