/**
 * #1430 P1 — THE PRE-MERGE BOUNDARY, WHICH DID NOT EXIST.
 *
 * Codex at `2e73a65d81`: freshness was checked only where a receipt is CREATED, never where a merge is
 * DECIDED. `merge-qualification` consumes job conclusions and nothing else — it never reloads the
 * receipt or re-reads thread state — so the whole chain still rested on a check that cannot re-fire.
 *
 * The gap is specific and it is not closable by triggers. GitHub emits no workflow event when a review
 * thread is resolved or unresolved, so a thread reopened after a green run leaves the required check
 * green until something unrelated happens to re-run it. Adding a trigger is not an option because the
 * event does not exist, and reading branch protection to prove the repository would block it is not an
 * option either: `github.token` cannot see the admin surfaces and a PR-controlled workflow must never
 * be handed `GH_PAT`.
 *
 * What IS available is the moment of merge itself. This module is that moment. It re-reads live thread
 * state, revalidates the age of the receipt the green run produced, and refuses to invoke the merge
 * unless both hold. A thread reopened at any point before merge is seen, because the read happens after
 * the reopen by construction.
 *
 * TWO INDEPENDENT CONDITIONS, DELIBERATELY. A live read alone would accept an ancient receipt whose
 * other evidence — CI, evidence artifacts — no longer describes the tree. An age check alone would
 * accept a fresh receipt while a thread sat reopened. Neither subsumes the other, so both are required
 * and each has its own casualty.
 *
 * THE MERGE EXECUTOR IS INJECTED AND CALLED LAST. It is the only side effect here, so "did we refuse?"
 * is observable as "was it called?" — which is what makes the refusals testable rather than asserted.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildReviewReceipt } from './collect-review-qualification.mjs';
import { RECEIPT_MAX_AGE_MS } from './review-qualification.mjs';

/** Why a merge was refused. Bounded, so a caller cannot invent a reason that reads as permission. */
export const PRE_MERGE_HOLD = Object.freeze({
  RECEIPT_MISSING: 'pre_merge_receipt_missing',
  RECEIPT_UNDATED: 'pre_merge_receipt_generated_at_missing_or_invalid',
  RECEIPT_STALE: 'pre_merge_receipt_stale',
  RECEIPT_FUTURE: 'pre_merge_receipt_generated_in_the_future',
  LIVE_READ_FAILED: 'pre_merge_live_thread_read_failed',
  HEAD_MOVED: 'pre_merge_head_moved',
  LIVE_FINDINGS: 'pre_merge_live_release_findings',
  /*
   * Codex P1s at `bef689f007`, and both were mine. The boundary validated the stored receipt's AGE and
   * nothing else, and judged the live read by `findingCount` alone.
   *
   * A fresh receipt from ANOTHER pull request, another head, or a run that was never eligible therefore
   * passed — the age was all that was ever checked. And `findingCount` counts only what the first page
   * returned, so a pull request with more than 100 threads/reviews/files/comments could hide a reopened
   * P0/P1 on page two and still merge. `buildReviewReceipt()` already reports both conditions in
   * `qualified`/`reasons`, including the `*_incomplete` pagination reasons; the boundary looked past that
   * verdict and re-derived a weaker one.
   *
   * Both receipts are now BOUND: qualified, no reasons, and addressed to this pull request and this head.
   */
  RECEIPT_NOT_QUALIFIED: 'pre_merge_receipt_not_qualified',
  RECEIPT_WRONG_PR: 'pre_merge_receipt_addresses_another_pull_request',
  RECEIPT_WRONG_HEAD: 'pre_merge_receipt_addresses_another_head',
  LIVE_NOT_QUALIFIED: 'pre_merge_live_receipt_not_qualified',
});

/**
 * Is this receipt qualified, addressed to this merge, and free of reasons?
 *
 * Shared by the stored and the live receipt on purpose: the two failure modes Codex found were the same
 * omission applied to each, so one predicate closes both and neither can drift from the other.
 */
function bindingHolds({ receipt, prNumber, expectedHeadSha, codes }) {
  const holds = [];
  const head = String(expectedHeadSha ?? '').toLowerCase();
  /*
   * EVERY FIELD IS REQUIRED TO BE PRESENT AND CORRECTLY TYPED. ABSENCE IS NOT A ZERO.
   *
   * Codex P1 at `e2d72b66cf`, reproduced by invoking the executor with a fresh, matching,
   * `qualified: true` receipt that simply OMITTED `reasons` and `findingCount`. My predicates were
   * `Array.isArray(reasons) && length > 0` and `(findingCount ?? 0) > 0`, so every one of these passed:
   * both fields missing; `reasons: 'open_findings:1'` as a string, where `Array.isArray` is false;
   * `findingCount: '0'` as a string, where `> 0` is false; and a negative count.
   *
   * This is the same error as #1430's own original finding — a missing `skippedTestFiles` array read as
   * "nothing was skipped" — which I required presence for in the merge script and then defaulted to
   * permissive in the boundary guarding it. So the contract here is explicit: `reasons` must BE an empty
   * array and `findingCount` must BE the integer zero. A receipt that cannot state these plainly is
   * malformed, and malformed evidence fails closed.
   */
  if (receipt?.qualified !== true) holds.push(codes.notQualified);
  if (!Array.isArray(receipt?.reasons) || receipt.reasons.length !== 0) holds.push(codes.notQualified);
  if (!Number.isInteger(receipt?.findingCount) || receipt.findingCount !== 0) {
    holds.push(codes.notQualified);
  }
  // A receipt that names no pull request cannot be shown to address THIS one.
  if (prNumber !== undefined && Number(receipt?.pullRequestNumber) !== Number(prNumber)) {
    holds.push(codes.wrongPr);
  }
  const currentSha = String(receipt?.currentSha ?? '').toLowerCase();
  const reviewedSha = String(receipt?.reviewedSha ?? '').toLowerCase();
  if (currentSha !== head || reviewedSha !== head) holds.push(codes.wrongHead);
  return [...new Set(holds)];
}

/**
 * Decide whether a merge may be invoked, and invoke it only if so.
 *
 * `readPullRequest` and `mergeExecutor` are injected rather than imported so this boundary can be
 * driven end to end by a casualty. The real callers pass the live GraphQL reader and the real merge.
 */
export async function guardedMerge({
  repository,
  prNumber,
  expectedHeadSha,
  token,
  priorReceipt,
  readPullRequest,
  mergeExecutor,
  now = Date.now(),
  maxAgeMs = RECEIPT_MAX_AGE_MS,
} = {}) {
  const holds = [];

  /*
   * THE RECEIPT'S AGE IS CHECKED FIRST, and a missing one is a hold rather than a reason to skip the
   * check. "No receipt" and "a receipt we cannot date" are both indistinguishable from stale, and
   * treating either as permission is the failure this exists to prevent.
   */
  if (!priorReceipt || typeof priorReceipt !== 'object') {
    holds.push(PRE_MERGE_HOLD.RECEIPT_MISSING);
  } else {
    const producedAt = Date.parse(String(priorReceipt.generatedAt ?? ''));
    if (!Number.isFinite(producedAt)) holds.push(PRE_MERGE_HOLD.RECEIPT_UNDATED);
    else if (now - producedAt < 0) holds.push(PRE_MERGE_HOLD.RECEIPT_FUTURE);
    else if (now - producedAt > maxAgeMs) {
      holds.push(`${PRE_MERGE_HOLD.RECEIPT_STALE}:${Math.round((now - producedAt) / 1000)}s`);
    }
    // Age alone was the whole of the old check. A fresh receipt from another PR or head passed it.
    holds.push(...bindingHolds({
      receipt: priorReceipt,
      prNumber,
      expectedHeadSha,
      codes: {
        notQualified: PRE_MERGE_HOLD.RECEIPT_NOT_QUALIFIED,
        wrongPr: PRE_MERGE_HOLD.RECEIPT_WRONG_PR,
        wrongHead: PRE_MERGE_HOLD.RECEIPT_WRONG_HEAD,
      },
    }));
  }

  /*
   * THE LIVE RE-READ. This is the half that sees a reopened thread, and it must happen here rather than
   * be taken from the green run — a receipt from that run cannot know about a reopen that came after it.
   * A read that throws is a hold: an unreadable thread state is not an empty one.
   */
  let live = null;
  try {
    live = await readPullRequest({ repository, number: prNumber, token });
  } catch {
    holds.push(PRE_MERGE_HOLD.LIVE_READ_FAILED);
  }

  if (live) {
    const liveHead = live?.headRefOid?.toLowerCase?.() ?? '';
    const expected = String(expectedHeadSha ?? '').toLowerCase();
    // The authorization named a SHA. If the head moved, this decision is about a different tree.
    if (!liveHead || liveHead !== expected) holds.push(PRE_MERGE_HOLD.HEAD_MOVED);

    const liveReceipt = buildReviewReceipt({ pullRequest: live, expectedHeadSha: expected });
    /*
     * THE LIVE RECEIPT'S OWN VERDICT GOVERNS, not a count taken from it.
     *
     * `buildReviewReceipt()` sets `qualified: false` with a `*_incomplete` reason when the read was
     * truncated — more than 100 threads, reviews, files or thread comments — and `findingCount` only
     * ever describes the page that came back. Judging by the count alone let a reopened P0/P1 on page
     * two read as zero findings and merge. The count is still reported, because it says WHY.
     */
    if ((liveReceipt.findingCount ?? 0) > 0) {
      holds.push(`${PRE_MERGE_HOLD.LIVE_FINDINGS}:${liveReceipt.findingCount}`);
    }
    if (liveReceipt.qualified !== true) {
      const why = (liveReceipt.reasons ?? []).join('|') || 'unqualified';
      holds.push(`${PRE_MERGE_HOLD.LIVE_NOT_QUALIFIED}:${why}`);
    }
  }

  if (holds.length > 0) {
    // The executor is NEVER reached on a hold. That is the whole contract.
    return { merged: false, holds, mergeInvoked: false };
  }

  const result = await mergeExecutor({ repository, number: prNumber, expectedHeadSha });
  return { merged: true, holds: [], mergeInvoked: true, result };
}


/**
 * THE LIVE READER. Kept here rather than imported from the collector so the CLI has exactly one
 * dependency on GraphQL and the casualty can substitute it.
 */
async function readPullRequestLive({ repository, number, token }) {
  const [owner, name] = String(repository).split('/');
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number headRefOid baseRefName files(first:100){nodes{path} pageInfo{hasNextPage}} reviews(last:100){nodes{author{login} state commit{oid} body submittedAt} pageInfo{hasPreviousPage}} reviewThreads(first:100){nodes{isResolved comments(last:100){nodes{author{login} body commit{oid} originalCommit{oid} pullRequestReview{commit{oid}}} pageInfo{hasPreviousPage}}} pageInfo{hasNextPage}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ query, variables: { owner, name, number: Number(number) } }),
  });
  if (!res.ok) throw new Error(`github_graphql_http_${res.status}`);
  const payload = await res.json();
  if (payload.errors?.length || !payload.data?.repository?.pullRequest) {
    throw new Error('github_graphql_pull_request_unavailable');
  }
  return payload.data.repository.pullRequest;
}

/**
 * THE ONLY PLACE THIS REPOSITORY INVOKES A MERGE.
 *
 * `GUARDED_MERGE_GH_BIN` exists so a casualty can substitute a recorder for `gh` and then assert on
 * whether a merge was ATTEMPTED — the observation that cannot be satisfied by a gate which reports a
 * refusal and merges anyway. It defaults to the real binary, so production behaviour is unchanged.
 */
function ghMergeExecutor({ number, expectedHeadSha }) {
  const bin = process.env.GUARDED_MERGE_GH_BIN || 'gh';
  const args = ['pr', 'merge', String(number), '--squash', '--delete-branch',
    '--match-head-commit', String(expectedHeadSha)];
  const run = spawnSync(bin, args, { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`gh_pr_merge_failed_status_${run.status}`);
  return { invoked: true, args };
}

/**
 * CLI. This is the repository's merge command; `pnpm merge:guarded` routes through it.
 *
 * The guard is not advisory here — it is the only path to the merge, because the merge call lives
 * behind it in this same module and nothing else in the repository invokes one. A hold exits non-zero
 * having called nothing.
 */
export async function main(argv = process.argv.slice(2)) {
  const arg = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const repository = arg('repo') ?? process.env.GITHUB_REPOSITORY ?? '';
  const prNumber = arg('pr') ?? process.env.PR_NUMBER ?? '';
  const expectedHeadSha = arg('sha') ?? process.env.EXPECTED_HEAD_SHA ?? '';
  const receiptPath = arg('receipt') ?? process.env.REVIEW_QUALIFICATION_FILE ?? '';
  const token = process.env.GITHUB_TOKEN ?? '';

  if (!/^[^/]+\/[^/]+$/.test(repository) || !/^[1-9]\d*$/.test(prNumber)
      || !/^[0-9a-f]{40}$/i.test(expectedHeadSha) || !token) {
    console.error('MERGE HELD: usage --repo=<owner/name> --pr=<n> --sha=<40-hex> --receipt=<file>, '
      + 'with GITHUB_TOKEN set');
    return 2;
  }

  // A receipt that cannot be READ is not a receipt. `guardedMerge` treats the missing case as a hold.
  let priorReceipt = null;
  if (receiptPath && existsSync(receiptPath)) {
    try { priorReceipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch { priorReceipt = null; }
  }

  const outcome = await guardedMerge({
    repository,
    prNumber: Number(prNumber),
    expectedHeadSha,
    token,
    priorReceipt,
    readPullRequest: readPullRequestLive,
    mergeExecutor: ghMergeExecutor,
  });

  if (!outcome.mergeInvoked) {
    console.error(`MERGE HELD: ${outcome.holds.join(', ')}`);
    return 1;
  }
  console.log(`MERGED ${repository}#${prNumber} at ${expectedHeadSha}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
