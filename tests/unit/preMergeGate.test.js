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
const bot = { login: 'chatgpt-codex-connector' };

/** A pull request as the LIVE GraphQL read returns it, with `threads` decided per case. */
const livePull = (threads) => ({
  number: 1430,
  headRefOid: HEAD,
  baseRefName: 'main',
  files: { nodes: [{ path: 'scripts/pre-merge-gate.mjs' }], pageInfo: { hasNextPage: false } },
  reviews: {
    nodes: [{
      author: bot, state: 'COMMENTED', commit: { oid: HEAD },
      body: 'reviewed', submittedAt: '2026-09-10T20:00:00Z',
    }],
    pageInfo: { hasPreviousPage: false },
  },
  reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false } },
});

const thread = (isResolved, body) => ({
  isResolved,
  comments: {
    nodes: [{
      author: bot, body,
      commit: { oid: HEAD }, originalCommit: { oid: HEAD },
      pullRequestReview: { commit: { oid: HEAD } },
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
  generatedAt: new Date(Date.now() - minutes * 60 * 1000).toISOString(),
  ...over,
});

const runGate = async ({ threads, priorReceipt, expectedHeadSha = HEAD, reader }) => {
  const mergeExecutor = vi.fn(async () => ({ sha: 'merged' }));
  const readPullRequest = reader ?? vi.fn(async () => livePull(threads));
  const outcome = await guardedMerge({
    repository: 'relativityE/speaksharp',
    prNumber: 1430,
    expectedHeadSha,
    token: 't',
    priorReceipt,
    readPullRequest,
    mergeExecutor,
  });
  return { outcome, mergeExecutor, readPullRequest };
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
