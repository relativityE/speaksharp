/**
 * #1430 P1, thread `3983020005` — REVALIDATE AT THE MERGE BOUNDARY, NOT AT RECEIPT CREATION.
 *
 * The defect Codex named, and the one my previous evidence did NOT test. I had observed that CI showed
 * no staleness reason and concluded the freshness mechanism worked. That inference was wrong: the
 * receipt is stamped and read moments later in the same run, so of course it reads fresh. Nothing in
 * that observation touches the actual failure, which is a thread REOPENED AFTER the check went green —
 * at which point no workflow event fires, nothing re-runs, and the green check still stands.
 *
 * So these cases drive the real pre-merge entry point end to end. `guardedMerge` recollects the pull
 * request through the injected live reader, revalidates the age of the receipt the green run produced,
 * and refuses to invoke the merge unless both hold.
 *
 * REFUSAL IS ASSERTED AS "THE EXECUTOR WAS NOT CALLED", not as a returned flag. The merge is the only
 * side effect at this boundary, so whether it happened is the only observation that cannot be satisfied
 * by a function that merely reports a refusal while merging anyway.
 */
import { describe, expect, it, vi } from 'vitest';
import { guardedMerge, PRE_MERGE_HOLD } from '../../scripts/pre-merge-gate.mjs';

const HEAD = 'e'.repeat(40);
/** The authorized base: `main` at the SHA the exact-head/base authorization named. */
const BASE = 'b'.repeat(40);
const REPOSITORY = 'relativityE/speaksharp';
const bot = { login: 'chatgpt-codex-connector' };

/** A pull request as the LIVE GraphQL read returns it, with `threads` decided per case. */
const livePull = (threads, over = {}) => ({
  number: 1430,
  headRefOid: HEAD,
  baseRefName: 'main',
  baseRefOid: BASE,
  baseRepository: { nameWithOwner: REPOSITORY },
  files: { nodes: [{ path: 'scripts/pre-merge-gate.mjs' }], pageInfo: { hasNextPage: false } },
  reviews: {
    nodes: [{
      author: bot, state: 'COMMENTED', commit: { oid: HEAD },
      body: 'reviewed', submittedAt: '2026-09-10T20:00:00Z',
    }],
    pageInfo: { hasPreviousPage: false },
  },
  reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false } },
  ...over,
});

/**
 * #1430 fix-forward `3991388525`: a RESOLVED same-head P0/P1 now blocks until a later clean re-review. The
 * resolved threads these cases use as "live state is clean" are therefore findings made at an EARLIER head,
 * which is what a resolved blocker from a previous round really is. The same-head case has its own cases.
 */
const PRIOR_HEAD = 'a'.repeat(40);
const thread = (isResolved, body, sha = isResolved ? PRIOR_HEAD : HEAD) => ({
  isResolved,
  comments: {
    nodes: [{
      author: bot, body, createdAt: '2026-09-10T20:00:00Z',
      commit: { oid: sha }, originalCommit: { oid: sha },
      pullRequestReview: { state: 'COMMENTED', commit: { oid: sha } },
    }],
    pageInfo: { hasPreviousPage: false },
  },
});

const RELEASE_FINDING_BODY = 'P1 Badge — a live release finding';

/**
 * The receipt the earlier green run produced. Age is the variable under test, so everything else is a
 * BOUND receipt: qualified, no reasons, no findings, and addressed to this pull request and this head.
 *
 * Binding is not incidental here — Codex found the boundary validated only `generatedAt`, so a fresh
 * receipt from another PR or head passed. The dedicated cases below vary each of those fields.
 */
const receiptAgedMinutes = (minutes, over = {}) => ({
  qualified: true,
  reasons: [],
  findingCount: 0,
  pullRequestNumber: 1430,
  currentSha: HEAD,
  reviewedSha: HEAD,
  repository: REPOSITORY,
  baseSha: BASE,
  generatedAt: new Date(Date.now() - minutes * 60 * 1000).toISOString(),
  ...over,
});

const runGate = async ({
  threads, priorReceipt, expectedHeadSha = HEAD, expectedBaseSha = BASE, repository = REPOSITORY, reader, live,
  // GitHub's up-to-date enforcement as the operator's credentials read it. Enforced unless a case says otherwise.
  protection = async () => 'enforced',
  executor,
}) => {
  const mergeExecutor = executor ?? vi.fn(async () => ({ sha: 'merged' }));
  const readPullRequest = reader ?? vi.fn(async () => livePull(threads, live));
  const readBaseProtection = vi.fn(protection);
  const outcome = await guardedMerge({
    repository,
    prNumber: 1430,
    expectedHeadSha,
    expectedBaseSha,
    token: 't',
    priorReceipt,
    readPullRequest,
    readBaseProtection,
    mergeExecutor,
  });
  return { outcome, mergeExecutor, readPullRequest, readBaseProtection };
};

describe('#1430 P1 — the pre-merge boundary rereads live state and revalidates the receipt', () => {
  it('CASUALTY: a thread REOPENED after the green run refuses the merge', async () => {
    /**
     * The exact defect. The receipt is perfectly fresh and says qualified — it was written before the
     * reopen and cannot know about it. Only the live re-read sees the thread, so if the boundary
     * trusted the receipt this would merge with a live P1 open.
     */
    const { outcome, mergeExecutor } = await runGate({
      threads: [thread(false, RELEASE_FINDING_BODY)],
      priorReceipt: receiptAgedMinutes(1),
    });

    expect(mergeExecutor, 'the merge must never be invoked with a live P1 open').not.toHaveBeenCalled();
    expect(outcome.mergeInvoked).toBe(false);
    expect(outcome.holds.join(' ')).toContain(PRE_MERGE_HOLD.LIVE_FINDINGS);
  });

  it('CASUALTY: a receipt past its age bound refuses the merge', async () => {
    // Live state is clean, so only the receipt's age can refuse here. A boundary that re-read threads
    // but never rechecked the age would merge on evidence that no longer describes the tree.
    const { outcome, mergeExecutor } = await runGate({
      threads: [thread(true, 'P1 Badge — addressed and resolved')],
      priorReceipt: receiptAgedMinutes(90),
    });

    expect(mergeExecutor, 'stale evidence must not merge').not.toHaveBeenCalled();
    expect(outcome.mergeInvoked).toBe(false);
    expect(outcome.holds.join(' ')).toContain(PRE_MERGE_HOLD.RECEIPT_STALE);
  });

  it('POSITIVE CONTROL: a fresh receipt plus a clean live read DOES invoke the merge', async () => {
    /**
     * Without this the two refusals above would pass against a boundary that refuses everything — which
     * is the failure mode I have hit repeatedly on this PR, so it is asserted rather than assumed.
     */
    const { outcome, mergeExecutor, readPullRequest } = await runGate({
      threads: [thread(true, 'P1 Badge — addressed and resolved')],
      priorReceipt: receiptAgedMinutes(1),
    });

    expect(readPullRequest, 'the live read really happened').toHaveBeenCalledTimes(1);
    expect(mergeExecutor, 'and the merge was invoked exactly once').toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ merged: true, mergeInvoked: true, holds: [] });
  });

  it('CASUALTY: an unreadable live thread state refuses rather than assuming it is clean', async () => {
    // An unreadable state is not an empty one. Treating a failed read as "no findings" would turn a
    // transient API failure into permission to merge.
    const { outcome, mergeExecutor } = await runGate({
      threads: [],
      priorReceipt: receiptAgedMinutes(1),
      reader: vi.fn(async () => { throw new Error('graphql exploded'); }),
    });

    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toContain(PRE_MERGE_HOLD.LIVE_READ_FAILED);
  });

  it('CASUALTY: a missing or undated receipt refuses rather than skipping the age check', async () => {
    // "No receipt" and "a receipt we cannot date" are both indistinguishable from stale.
    for (const priorReceipt of [null, { qualified: true }, { qualified: true, generatedAt: 'not-a-date' }]) {
      const { outcome, mergeExecutor } = await runGate({
        threads: [thread(true, 'P1 Badge — resolved')],
        priorReceipt,
      });
      expect(mergeExecutor).not.toHaveBeenCalled();
      expect(outcome.holds.some((h) => h.startsWith('pre_merge_receipt_'))).toBe(true);
    }
  });

  it('CASUALTY: a head that moved since authorization refuses the merge', async () => {
    // The authorization named a SHA; if the live head is a different commit, this decision is about a
    // different tree than the one that was reviewed and authorized.
    const { outcome, mergeExecutor } = await runGate({
      threads: [thread(true, 'P1 Badge — resolved')],
      priorReceipt: receiptAgedMinutes(1),
      expectedHeadSha: 'f'.repeat(40),
    });

    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toContain(PRE_MERGE_HOLD.HEAD_MOVED);
  });
});

describe('#1430 P1s `3986417422` + `3986417417` — the merge is bound to the authorized base and repository', () => {
  const ADVANCED = 'c'.repeat(40);
  const resolved = () => [thread(true, 'P1 Badge — addressed and resolved')];

  /*
   * EVERY REFUSAL BELOW IS ASSERTED WITH `toEqual([code])`, NOT `toContain`. A fixture that tripped two
   * predicates would prove neither, and a mutation deleting one of them would survive behind the other.
   * Where a malformed value is under test it is supplied CONSISTENTLY to the authorization, the receipt and
   * the live read, so the shape check is the only thing left that can refuse.
   */

  it('CASUALTY: a matching head on an ADVANCED live base refuses the merge', async () => {
    /**
     * Codex P1 `3986417422`. The receipt and the authorization agree on the base; only the live base has
     * moved. Binding the head alone let the same reviewed head squash-land on a `main` nobody reviewed, and
     * this repository has no "require branch up to date" protection that would catch it instead.
     */
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1), live: { baseRefOid: ADVANCED },
    });
    expect(mergeExecutor, 'a moved base must never merge').not.toHaveBeenCalled();
    expect(outcome.holds).toEqual([PRE_MERGE_HOLD.BASE_MOVED]);
  });

  it('CASUALTY: a live read with NO base OID refuses rather than skipping the comparison', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1), live: { baseRefOid: undefined },
    });
    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toEqual([PRE_MERGE_HOLD.BASE_MOVED]);
  });

  it('CASUALTY: a MALFORMED authorized base SHA refuses, even when every other source repeats it', async () => {
    for (const bad of ['not-a-sha', BASE.slice(1), `${BASE}0`, 'g'.repeat(40)]) {
      const { outcome, mergeExecutor } = await runGate({
        threads: resolved(),
        expectedBaseSha: bad,
        priorReceipt: receiptAgedMinutes(1, { baseSha: bad }),
        live: { baseRefOid: bad },
      });
      expect(mergeExecutor, `base ${JSON.stringify(bad)} must not merge`).not.toHaveBeenCalled();
      expect(outcome.holds).toEqual([PRE_MERGE_HOLD.BASE_UNAUTHORIZED]);
    }
  });

  it('CASUALTY: a MISSING authorized base SHA refuses', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1), expectedBaseSha: null,
    });
    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toContain(PRE_MERGE_HOLD.BASE_UNAUTHORIZED);
  });

  it('CASUALTY: a stored receipt produced against ANOTHER base refuses', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1, { baseSha: ADVANCED }),
    });
    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toEqual([PRE_MERGE_HOLD.RECEIPT_WRONG_BASE]);
  });

  it('CASUALTY: a stored receipt that OMITS its base refuses — absence is not a match', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1, { baseSha: undefined }),
    });
    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toEqual([PRE_MERGE_HOLD.RECEIPT_WRONG_BASE]);
  });

  it('CASUALTY: a stored receipt for ANOTHER repository refuses', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1, { repository: 'someone/else' }),
    });
    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toEqual([PRE_MERGE_HOLD.RECEIPT_WRONG_REPOSITORY]);
  });

  it('CASUALTY: a live pull request in ANOTHER repository, or naming none, refuses', async () => {
    for (const baseRepository of [{ nameWithOwner: 'someone/else' }, undefined]) {
      const { outcome, mergeExecutor } = await runGate({
        threads: resolved(), priorReceipt: receiptAgedMinutes(1), live: { baseRepository },
      });
      expect(mergeExecutor, `live repository ${JSON.stringify(baseRepository)} must not merge`).not.toHaveBeenCalled();
      expect(outcome.holds).toEqual([PRE_MERGE_HOLD.LIVE_WRONG_REPOSITORY]);
    }
  });

  it('CASUALTY: a MALFORMED authorized repository refuses, even when every other source repeats it', async () => {
    for (const bad of ['no-slash', 'a/b/c', 'own er/name']) {
      const { outcome, mergeExecutor } = await runGate({
        threads: resolved(),
        repository: bad,
        priorReceipt: receiptAgedMinutes(1, { repository: bad }),
        live: { baseRepository: { nameWithOwner: bad } },
      });
      expect(mergeExecutor, `repository ${JSON.stringify(bad)} must not merge`).not.toHaveBeenCalled();
      expect(outcome.holds).toEqual([PRE_MERGE_HOLD.REPOSITORY_UNAUTHORIZED]);
    }
  });

  it('CASUALTY: a pull request whose base branch is NOT `main` refuses, even when its base SHA matches', async () => {
    /**
     * The authorization is for `main` at one SHA. A pull request targeting any other branch is not that
     * merge, even when that branch's tip happens to equal the authorized base SHA — which is exactly the
     * case the SHA comparison alone cannot tell apart. A missing branch name is a hold, not a skip.
     */
    for (const baseRefName of ['release', 'Main', undefined]) {
      const { outcome, mergeExecutor } = await runGate({
        threads: resolved(), priorReceipt: receiptAgedMinutes(1), live: { baseRefName },
      });
      expect(mergeExecutor, `base branch ${JSON.stringify(baseRefName)} must not merge`).not.toHaveBeenCalled();
      expect(outcome.holds).toEqual([PRE_MERGE_HOLD.BASE_NOT_MAIN]);
    }
  });

  it('POSITIVE CONTROL: the exact repository, PR, head and base DOES invoke the merge, passing all four', async () => {
    /**
     * Without this every refusal above could pass against a gate that refuses everything. The executor's
     * arguments are asserted as well, because repository propagation is the other half of `3986417417`: a
     * guard that validated one repository and merged in whichever one the checkout belongs to would still
     * count as "invoked".
     */
    const { outcome, mergeExecutor } = await runGate({ threads: resolved(), priorReceipt: receiptAgedMinutes(1) });
    expect(outcome).toMatchObject({ merged: true, mergeInvoked: true, holds: [] });
    expect(mergeExecutor).toHaveBeenCalledTimes(1);
    expect(mergeExecutor).toHaveBeenCalledWith({
      repository: REPOSITORY, number: 1430, expectedHeadSha: HEAD, expectedBaseSha: BASE,
    });
  });
});

describe('#1430 P1 `3988517243` — the merge proceeds only where GitHub itself enforces an up-to-date base', () => {
  const resolved = () => [thread(true, 'P1 Badge — addressed and resolved')];

  /*
   * No client-side merge API can pin the base SHA: `gh pr merge` and every GraphQL merge input bind the HEAD
   * only. The race between the guard's final live base read and the merge is therefore closed by GitHub's own
   * "Require branches to be up to date before merging" rule, bound to admins too, which rejects an out-of-date
   * head at merge time. This boundary's job is to REFUSE unless that enforcement is read and enabled, and to
   * report GitHub's rejection honestly when the race is lost.
   *
   * Every refusal is asserted with `toEqual([code])`, so exactly one predicate can refuse each case.
   */

  it('CASUALTY: up-to-date enforcement read as NOT enforced refuses the merge', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1), protection: async () => 'not_enforced',
    });
    expect(mergeExecutor, 'without platform enforcement the base race is open').not.toHaveBeenCalled();
    expect(outcome.holds).toEqual([PRE_MERGE_HOLD.UP_TO_DATE_NOT_ENFORCED]);
  });

  it('CASUALTY: anything but the exact `enforced` verdict refuses — a truthy value is not enforcement', async () => {
    for (const verdict of [true, 'ENFORCED', undefined, null, { strict: true }]) {
      const { outcome, mergeExecutor } = await runGate({
        threads: resolved(), priorReceipt: receiptAgedMinutes(1), protection: async () => verdict,
      });
      expect(mergeExecutor, `verdict ${JSON.stringify(verdict)} must not merge`).not.toHaveBeenCalled();
      expect(outcome.holds).toEqual([PRE_MERGE_HOLD.UP_TO_DATE_NOT_ENFORCED]);
    }
  });

  it('CASUALTY: UNREADABLE enforcement refuses — unreadable is never treated as enabled', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1),
      protection: async () => { throw new Error('github_api_403'); },
    });
    expect(mergeExecutor).not.toHaveBeenCalled();
    expect(outcome.holds).toEqual([PRE_MERGE_HOLD.UP_TO_DATE_UNREADABLE]);
  });

  it('CASUALTY (race analogue): GitHub rejecting the merge after the final live read is reported, never as merged', async () => {
    /**
     * The base can still advance between the guard's last read and the merge call. With strict enforcement
     * GitHub refuses the now out-of-date head, and the executor surfaces that as a failure. The rejection must be
     * reported by name; it must neither escape as an unhandled error nor read as a merge.
     */
    const { outcome, mergeExecutor } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1),
      executor: vi.fn(async () => { throw new Error('gh_pr_merge_failed_status_1'); }),
    });
    expect(mergeExecutor, 'the merge was attempted').toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ merged: false, mergeInvoked: true, holds: [PRE_MERGE_HOLD.MERGE_REJECTED] });
  });

  it('POSITIVE CONTROL: enforced up-to-date protection and the exact tuple DOES merge, after reading enforcement for this repository', async () => {
    const { outcome, mergeExecutor, readBaseProtection } = await runGate({
      threads: resolved(), priorReceipt: receiptAgedMinutes(1),
    });
    expect(readBaseProtection, 'enforcement was read for the authorized repository').toHaveBeenCalledWith({
      repository: REPOSITORY, token: 't',
    });
    expect(mergeExecutor).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ merged: true, mergeInvoked: true, holds: [] });
  });
});

describe('#1430 fix-forward `3991388525` — a resolved same-head blocker does not merge without a clean re-review', () => {
  const sameHeadResolved = () => [thread(true, 'P1 Badge — resolved without re-review', HEAD)];
  /** A clean Codex result posted after the finding, naming this head in full (#1438 PM RETURN `5638958869`). */
  const cleanReReview = {
    comments: {
      nodes: [{
        id: 'clean', author: bot, authorAssociation: 'NONE', createdAt: '2026-09-10T20:05:00Z',
        body: `Codex Review: Didn't find any major issues. Swish!\n\n**Reviewed commit:** \`${HEAD}\``,
      }],
      pageInfo: { hasPreviousPage: false },
    },
  };

  it('CASUALTY: resolved at the authorized head and never re-reviewed — the executor is not called', async () => {
    const { outcome, mergeExecutor } = await runGate({ threads: sameHeadResolved(), priorReceipt: receiptAgedMinutes(1) });
    expect(mergeExecutor).not.toHaveBeenCalled();
    // The finding is counted AND the live receipt's own verdict refuses, for the same single reason.
    expect(outcome.holds).toEqual([
      `${PRE_MERGE_HOLD.LIVE_FINDINGS}:1`,
      `${PRE_MERGE_HOLD.LIVE_NOT_QUALIFIED}:open_findings:1`,
    ]);
  });

  it('CONTROL: the same thread followed by a clean re-review bound to this head merges', async () => {
    const { outcome, mergeExecutor } = await runGate({
      threads: sameHeadResolved(), priorReceipt: receiptAgedMinutes(1), live: cleanReReview,
    });
    expect(mergeExecutor).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ merged: true, mergeInvoked: true, holds: [] });
  });
});
