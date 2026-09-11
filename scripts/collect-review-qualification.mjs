#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluateReviewQualification, formatReviewQualification } from './review-qualification.mjs';

const CODEX_LOGINS = new Set(['chatgpt-codex-connector', 'chatgpt-codex-connector[bot]']);
/**
 * #1430 P1 — ONLY P0/P1 BLOCKS. P2 IS COUNTED AND REPORTED, NEVER BLOCKING.
 *
 * This matched `P[012]`, so a single P2 — hardening, a nit, a suggestion — disqualified the head and
 * failed the merge gate. That contradicts the standing closure rule, under which P2 and below route to
 * the hardening ledger and do not hold a release. A gate that blocks on advisory findings trains people
 * to bypass it, which costs more than the findings are worth.
 *
 * P2s are still surfaced on the receipt so nothing is hidden by being non-blocking.
 */
const RELEASE_FINDING = /P[01]\s+Badge|\bP[01]\b/i;
const ADVISORY_FINDING = /P2\s+Badge|\bP2\b/i;

/**
 * #1430 P1 — THE CANONICAL CLEAN RESULT, MATCHED POSITIVELY.
 *
 * Codex prefixes several different outcomes with `Codex Review:`, so the prefix proves nothing. Observed
 * on this pull request alone:
 *
 *   Codex Review: Didn't find any major issues. Keep it up!            <- clean
 *   Codex Review: Didn't find any major issues. Nice work!             <- clean (sign-off varies)
 *   Codex Review: Something went wrong. Try again later by commenting  <- NOT clean
 *   ## Blocked — Required Commit Objects Are Still Unavailable         <- NOT clean
 *
 * My recogniser previously selected a comment by three REJECTIONS — trusted author, exact head named, no
 * P0/P1 badge — and never asserted what a clean result actually says. Codex reproduced
 * `buildReviewReceipt()` qualifying on `Codex could not complete this review` plus a valid footer: a
 * failure notice read as a pass. The "Something went wrong" comment already on this PR would have done
 * the same had it carried a footer.
 *
 * This is the rule I wrote two rounds earlier and then broke: assert the shape you REQUIRE, never test
 * for the shape you reject. An absent badge is not evidence of a clean review.
 *
 * The sign-off varies and the apostrophe may be typographic, so only the invariant phrase is matched.
 */
const CODEX_CLEAN_RESULT = /Didn[\u2019']t\s+find\s+any\s+major\s+issues/i;

function isCodex(login) {
  return CODEX_LOGINS.has(String(login ?? '').toLowerCase());
}

function commentNamesHead(comment, head) {
  const named = /Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/i.exec(comment?.body ?? '');
  if (!named) return false;
  const shortSha = named[1].toLowerCase();
  return shortSha.length >= 7 && head.startsWith(shortSha);
}

/**
 * #1430 P1 — CODEX'S CLEAN RESULT IS NOT A REVIEW OBJECT.
 *
 * Codex submits a review object only when it HAS findings. When it finds nothing it posts an ISSUE
 * COMMENT plus a 👍 and creates no review. Deriving the verdict from `reviews` alone therefore made this
 * gate unsatisfiable: findings present meant `open_findings`, findings absent meant
 * `review_not_completed:missing`. Both branches held, so no candidate could ever qualify — the same
 * outage shape as holding on unverifiable branch protection.
 *
 * I had already recorded this surface in the #1431 post-mortem and then built a collector that ignored
 * it, which is why the recognition below is deliberately narrow rather than permissive:
 *
 *   TRUSTED AUTHOR ONLY. The same `CODEX_LOGINS` set the review path uses. A human — or any other bot —
 *   posting the same words proves nothing, so `authorAssociation` is not consulted and the login must
 *   match exactly.
 *
 *   THE EXACT HEAD, NAMED IN THE BODY. Codex writes "**Reviewed commit:** `<sha>`". A comment naming an
 *   earlier SHA is evidence about an earlier tree and is ignored, not tolerated — this is the same
 *   stale-evidence rule the rest of the receipt applies.
 *
 *   NO FINDING TEXT. A comment carrying a P0/P1 badge is not a clean result whatever else it says.
 *
 * Returns the matching comment or null. It NEVER reports findings — it can only establish that a review
 * completed with none, and the thread scan remains the sole authority on live findings.
 */
function findTrustedCleanResult({ pullRequest, head }) {
  return (pullRequest?.comments?.nodes ?? [])
    .filter((comment) => isCodex(comment?.author?.login))
    // POSITIVE match first: only the canonical clean result may qualify a head. Error, status, progress
    // and blocked notices from the same trusted bot are not clean reviews, whatever footer they carry.
    .filter((comment) => CODEX_CLEAN_RESULT.test(comment?.body ?? ''))
    .filter((comment) => !RELEASE_FINDING.test(comment?.body ?? ''))
    // Codex abbreviates the SHA, so the named value must PREFIX the full head — never the reverse,
    // which would let a 7-character coincidence from another branch qualify.
    .filter((comment) => commentNamesHead(comment, head))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1) ?? null;
}

export function buildReviewReceipt({ pullRequest, expectedHeadSha }) {
  const head = pullRequest?.headRefOid?.toLowerCase?.() ?? '';
  const expected = expectedHeadSha?.toLowerCase?.() ?? '';
  const reasons = [];
  if (head !== expected) reasons.push('github_pr_head_is_not_workflow_head');
  if (pullRequest?.files?.pageInfo?.hasNextPage) reasons.push('changed_files_incomplete');
  if (pullRequest?.reviews?.pageInfo?.hasPreviousPage) reasons.push('review_history_incomplete');
  if (pullRequest?.reviewThreads?.pageInfo?.hasNextPage) reasons.push('review_threads_incomplete');
  if ((pullRequest?.reviewThreads?.nodes ?? []).some((thread) => thread?.comments?.pageInfo?.hasPreviousPage)) {
    reasons.push('review_thread_comments_incomplete');
  }
  // The clean-result surface is now load-bearing, so an incomplete read of it is incomplete evidence.
  // Without this a truncated comment page could hide the very comment that would have qualified — or,
  // worse, hide a later finding-bearing one.
  if (pullRequest?.comments?.pageInfo?.hasPreviousPage) reasons.push('issue_comments_incomplete');

  const reviews = (pullRequest?.reviews?.nodes ?? [])
    .filter((review) => isCodex(review?.author?.login) && review?.state !== 'DISMISSED' && review?.commit?.oid?.toLowerCase?.() === head)
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const latest = reviews.at(-1);
  // Only consulted when no finding-bearing review object exists at this head: a review that reported
  // findings must never be masked by a later clean summary.
  const cleanResult = latest ? null : findTrustedCleanResult({ pullRequest, head });
  const threadFindings = (pullRequest?.reviewThreads?.nodes ?? []).filter((thread) =>
    thread?.isResolved === false
    && (thread?.comments?.nodes ?? []).some((comment) =>
      isCodex(comment?.author?.login)
      && (comment?.pullRequestReview?.commit?.oid ?? comment?.originalCommit?.oid ?? comment?.commit?.oid)?.toLowerCase?.() === head
      && RELEASE_FINDING.test(comment?.body ?? '')));
  const reviewBodyFindings = reviews.filter((review) => RELEASE_FINDING.test(review?.body ?? ''));
  const blockingReviews = reviews.filter((review) => review?.state === 'CHANGES_REQUESTED');
  const issueCommentFindings = (pullRequest?.comments?.nodes ?? []).filter((comment) =>
    isCodex(comment?.author?.login)
    && commentNamesHead(comment, head)
    && RELEASE_FINDING.test(comment?.body ?? ''));
  const findingCount = threadFindings.length + reviewBodyFindings.length + blockingReviews.length
    + issueCommentFindings.length;
  // Counted for the receipt only — never added to `findingCount`, which is what gates qualification.
  const advisoryCount = (pullRequest?.reviewThreads?.nodes ?? []).filter((thread) =>
    thread?.isResolved === false
    && (thread?.comments?.nodes ?? []).some((comment) =>
      isCodex(comment?.author?.login)
      && (comment?.pullRequestReview?.commit?.oid ?? comment?.originalCommit?.oid ?? comment?.commit?.oid)?.toLowerCase?.() === head
      && ADVISORY_FINDING.test(comment?.body ?? ''))).length
    + (pullRequest?.comments?.nodes ?? []).filter((comment) =>
      isCodex(comment?.author?.login)
      && commentNamesHead(comment, head)
      && ADVISORY_FINDING.test(comment?.body ?? '')).length;

  const evaluated = evaluateReviewQualification({
    currentSha: head,
    // #1430 P1 — stamped so a merge decision can require a receipt produced immediately beforehand.
    // A thread reopened after this moment makes this receipt stale, which is how the reopen gap is
    // closed without a webhook.
    generatedAt: new Date().toISOString(),
    reviewedSha: latest?.commit?.oid ?? (cleanResult ? expectedHeadSha : undefined),
    reviewStatus: latest && blockingReviews.length === 0 ? 'completed'
      : latest ? 'changes_requested'
        : cleanResult ? 'completed'
          : 'missing',
    findingCount,
    changedFiles: (pullRequest?.files?.nodes ?? []).map(({ path }) => path),
  });
  return {
    ...evaluated,
    qualified: evaluated.qualified && reasons.length === 0,
    reasons: [...reasons, ...evaluated.reasons],
    pullRequestNumber: pullRequest?.number ?? null,
    /**
     * #1430 P1s `3986417417` + `3986417422` — WHAT THIS EVIDENCE IS ABOUT, AS GITHUB REPORTS IT.
     *
     * Head and PR number alone let a receipt authorize a merge in another repository, or onto a base that
     * advanced after review. Both are recorded from the live read, never from an input, so the merge
     * boundary can require the repository and base the merge was authorized for.
     */
    repository: pullRequest?.baseRepository?.nameWithOwner ?? null,
    baseSha: pullRequest?.baseRefOid?.toLowerCase?.() ?? null,
    reviewSubmittedAt: latest?.submittedAt ?? cleanResult?.createdAt ?? null,
    /** Which surface established the review: a review object, or Codex's clean-result comment. */
    reviewEvidence: latest ? 'review_object' : cleanResult ? 'clean_result_comment' : null,
    /** Open P2 findings at this head. Reported for the ledger; deliberately not blocking. */
    advisoryFindingCount: advisoryCount,
  };
}

export function reviewThreadResolutionIsEnforced({ branchProtection, branchRules, branchRulesets }) {
  const bypassAllowances = branchProtection?.required_pull_request_reviews?.bypass_pull_request_allowances;
  const legacyHasBypass = ['users', 'teams', 'apps'].some((key) =>
    Array.isArray(bypassAllowances?.[key]) && bypassAllowances[key].length > 0);
  const legacyEnforced = branchProtection?.required_conversation_resolution?.enabled === true
    && branchProtection?.enforce_admins?.enabled === true
    && !legacyHasBypass;
  if (legacyEnforced) return true;

  const detailedRulesets = Array.isArray(branchRulesets) ? branchRulesets : [];
  return Array.isArray(branchRules) && branchRules.some((rule) => {
    if (rule?.type !== 'pull_request' || rule?.parameters?.required_review_thread_resolution !== true) {
      return false;
    }
    const ruleset = detailedRulesets.find((candidate) => candidate?.id === rule?.ruleset_id);
    return ruleset?.enforcement === 'active'
      && Array.isArray(ruleset?.bypass_actors)
      && ruleset.bypass_actors.length === 0;
  });
}

async function githubRequest(path, token, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`github_api_${response.status}`);
  return response.json();
}

/**
 * #1430 P1 — "COULD NOT READ" IS NOT "NOT CONFIGURED".
 *
 * Branch protection and rulesets need admin scope. `github.token` does not carry it, so these reads
 * return 401/403/404 and this returned `null` — which the caller then reported as
 * `review_thread_resolution_not_enforced_at_merge`, a definite statement that the repository does NOT
 * enforce review-thread resolution. The gate was asserting a fact it had no ability to observe, on a
 * repository where the enforcement may well be configured.
 *
 * The three outcomes are now distinct: readable and enforced, readable and not enforced, and
 * UNREADABLE. Only the middle one is a finding about the repository.
 */
const UNREADABLE = Symbol('unreadable');

async function optionalGithubRequest(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  // 401 is included deliberately: an invalid or expired credential is the same epistemic state as an
  // unauthorised one — we cannot see the setting — and it must not be reported as its absence.
  if (response.status === 401 || response.status === 403 || response.status === 404) return UNREADABLE;
  if (!response.ok) throw new Error(`github_api_${response.status}`);
  return response.json();
}

/**
 * Returns `true`, `false`, or `'unverified'` — never conflating the last two.
 *
 * If BOTH admin surfaces are unreadable we know nothing and say so. If either is readable, the
 * enforcement question can be answered from what we could see.
 */
export { normaliseRef, resolveQualificationTarget };

export async function readReviewThreadResolutionEnforcement({ repository, branch, token }) {
  const encodedBranch = encodeURIComponent(branch);
  const [rawProtection, rawRules] = await Promise.all([
    optionalGithubRequest(`/repos/${repository}/branches/${encodedBranch}/protection`, token),
    optionalGithubRequest(`/repos/${repository}/rules/branches/${encodedBranch}?per_page=100`, token),
  ]);
  /**
   * #1430 P1 — ONE UNREADABLE SURFACE IS STILL BLINDNESS.
   *
   * My first version reported `unverified` only when BOTH surfaces were unreadable. Exact-head CI
   * disproved it: `/rules/branches/main` is readable and returns an empty list, while
   * `/branches/main/protection` needs admin scope and is not. Treating the readable half as the whole
   * answer concluded "not enforced" from a list that cannot see legacy branch protection at all — the
   * same false claim in a narrower disguise.
   *
   * Enforcement can be established by EITHER surface, so a definite `false` requires having read BOTH.
   * If either is unreadable and what we could read does not positively establish enforcement, the
   * honest answer is that we do not know.
   */
  const branchProtection = rawProtection === UNREADABLE ? null : rawProtection;
  const branchRules = rawRules === UNREADABLE ? null : rawRules;
  const anyUnreadable = rawProtection === UNREADABLE || rawRules === UNREADABLE;
  const rulesetIds = Array.isArray(branchRules)
    ? [...new Set(branchRules
      .filter((rule) => rule?.type === 'pull_request'
        && rule?.parameters?.required_review_thread_resolution === true
        && Number.isInteger(rule?.ruleset_id))
      .map((rule) => rule.ruleset_id))]
    : [];
  const rawRulesets = await Promise.all(rulesetIds.map((rulesetId) =>
    optionalGithubRequest(`/repos/${repository}/rulesets/${rulesetId}?includes_parents=true`, token)));
  const branchRulesets = rawRulesets.filter((ruleset) => ruleset !== UNREADABLE);
  /*
   * #1430 P1 — AN UNREADABLE RULESET DETAIL IS ALSO BLINDNESS.
   *
   * A referenced ruleset whose detail could not be read was filtered out here and then evaluated as
   * absent, so a rule that DOES require review-thread resolution could be dropped and the answer come
   * back `false`. Any unreadable relevant surface — protection, the rules list, or a referenced
   * ruleset — means we cannot conclude absence.
   */
  const anyRulesetUnreadable = rawRulesets.some((ruleset) => ruleset === UNREADABLE);
  const enforced = reviewThreadResolutionIsEnforced({ branchProtection, branchRules, branchRulesets });
  // A positive finding stands on what we could read. A negative one requires having read everything.
  if (enforced) return true;
  return (anyUnreadable || anyRulesetUnreadable) ? 'unverified' : false;
}

/**
 * #1430 P1 — A PUSH MUST CARRY VERIFIABLE REVIEW AUTHORITY, OR HOLD.
 *
 * `review-qualification` used to skip every `push`, and `merge-qualification` dropped it from its
 * required set on a post-merge push — so a commit that reached `main` directly was reported release-
 * qualified having had no review authority examined at all. `main` is where the release is cut from,
 * which makes it the one ref where that matters most.
 *
 * The push lane cannot reuse the PR rule: after a squash the pushed SHA is a merge commit and no OPEN
 * pull request has it as a head. So the push lane resolves the MERGED pull request associated with the
 * pushed commit and qualifies the SHA that pull request was actually reviewed at.
 *
 * FAIL CLOSED IN EVERY DIRECTION. Zero associated merged PRs is a direct push and holds. More than one
 * is ambiguous authority and holds. An unreadable head SHA holds. None of these degrade to a pass, and
 * the reason names which one it was.
 *
 * Returns the pull request to read AND the SHA whose review authority governs, because on a push those
 * are different commits and conflating them would qualify a merge commit nobody reviewed.
 */
async function resolveQualificationTarget({
  repository, expectedHeadSha, token, explicitNumber, eventName, baseRef,
}) {
  if (/^[1-9]\d*$/.test(explicitNumber ?? '')) {
    return { number: Number(explicitNumber), reviewedSha: expectedHeadSha };
  }
  const candidates = await githubRequest(`/repos/${repository}/commits/${expectedHeadSha}/pulls`, token);
  const sha = expectedHeadSha.toLowerCase();

  /*
   * THE PUSH LANE IS DECIDED FIRST, AND NEVER FALLS BACK TO THE PR RULE.
   *
   * Codex P1 at `763e644c90`, and it was right on two counts. My first version tried the open-PR rule
   * before the push rule, so a push whose tip was ALSO an open PR head returned through the PR branch
   * and never reached the merged-PR requirement — which is the realistic bypass, not the exotic one:
   * push a reviewed PR head straight to `main` and it qualified. It also matched merged PRs on
   * `head.sha` and never checked `baseRefName`, so a commit merged into some OTHER branch qualified
   * against `main`.
   *
   * Both routes closed by requiring, for a push, exactly one merged pull request whose MERGE COMMIT is
   * the pushed SHA and whose BASE is the pushed ref. A reviewed head pushed directly is not a merge
   * commit of anything, so it holds; a PR merged elsewhere fails the base comparison, so it holds.
   */
  if (eventName === 'push') {
    const base = normaliseRef(baseRef);
    if (!base) throw new Error('push_base_ref_unreadable');
    const merged = candidates.filter((pull) => Boolean(pull.merged_at)
      && pull.merge_commit_sha?.toLowerCase() === sha
      && normaliseRef(pull.base?.ref) === base);
    if (merged.length !== 1) throw new Error(`push_without_verifiable_merge_into_base:${merged.length}`);
    const reviewedSha = (merged[0].head?.sha ?? '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(reviewedSha)) throw new Error('push_associated_pr_head_sha_unreadable');
    return { number: merged[0].number, reviewedSha };
  }

  const open = candidates.filter((pull) => pull.state === 'open' && pull.head?.sha?.toLowerCase() === sha);
  if (open.length !== 1) throw new Error(`expected_one_open_pr_for_head:${open.length}`);
  return { number: open[0].number, reviewedSha: expectedHeadSha };
}

/** `refs/heads/main` and `main` are the same ref; compare them as one. */
function normaliseRef(ref) {
  return String(ref ?? '').replace(/^refs\/heads\//, '').trim().toLowerCase();
}

/**
 * #1430 P1 `3985755149` — ONE QUERY FOR EVERY READER OF REVIEW EVIDENCE.
 *
 * The pre-merge gate had its own copy of this query. When the clean-result surface became load-bearing
 * I added `comments` here and not there, so the gate could never see Codex's zero-finding result and
 * refused every legitimately clean PR at merge. Two copies of an evidence query can disagree about what
 * the evidence is; one exported copy cannot.
 */
export const PULL_REQUEST_REVIEW_QUERY = `query($owner:String!,$name:String!,$number:Int!,$commentsBefore:String){repository(owner:$owner,name:$name){pullRequest(number:$number){number headRefOid baseRefName baseRefOid baseRepository{nameWithOwner} files(first:100){nodes{path} pageInfo{hasNextPage}} reviews(last:100){nodes{author{login} state commit{oid} body submittedAt} pageInfo{hasPreviousPage}} reviewThreads(first:100){nodes{isResolved comments(last:100){nodes{author{login} body commit{oid} originalCommit{oid} pullRequestReview{commit{oid}}} pageInfo{hasPreviousPage}}} pageInfo{hasNextPage}} comments(last:100,before:$commentsBefore){nodes{id author{login} authorAssociation body createdAt} pageInfo{hasPreviousPage startCursor}}}}}`;

/**
 * The conversation surface is load-bearing and long-lived PRs routinely exceed one GraphQL page.
 * Ten pages is a bounded 1,000-comment read. Reaching the cap leaves `hasPreviousPage` true so the
 * existing receipt logic fails closed as `issue_comments_incomplete`.
 */
export const ISSUE_COMMENT_PAGE_CAP = 10;

function commentIdentity(comment) {
  return String(comment?.id ?? `${comment?.createdAt ?? ''}\u0000${comment?.author?.login ?? ''}\u0000${comment?.body ?? ''}`);
}

export async function readPullRequest({ repository, number, token, pageCap = ISSUE_COMMENT_PAGE_CAP }) {
  const [owner, name] = repository.split('/');
  const query = PULL_REQUEST_REVIEW_QUERY;
  const requestPage = (commentsBefore = null) => githubRequest('/graphql', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { owner, name, number, commentsBefore } }),
  });
  const payload = await requestPage();
  if (payload.errors?.length || !payload.data?.repository?.pullRequest) throw new Error('github_graphql_pull_request_unavailable');
  const pullRequest = payload.data.repository.pullRequest;
  const comments = pullRequest.comments ?? { nodes: [], pageInfo: { hasPreviousPage: false } };
  const allComments = [...(comments.nodes ?? [])];
  let pageInfo = comments.pageInfo ?? { hasPreviousPage: false };
  let pagesRead = 1;

  while (pageInfo.hasPreviousPage === true && pagesRead < pageCap) {
    const cursor = pageInfo.startCursor;
    if (!cursor) break;
    let olderPayload;
    try {
      olderPayload = await requestPage(cursor);
    } catch {
      break;
    }
    const older = olderPayload?.data?.repository?.pullRequest?.comments;
    if (olderPayload?.errors?.length || !older) break;
    allComments.unshift(...(older.nodes ?? []));
    pageInfo = older.pageInfo ?? { hasPreviousPage: true };
    pagesRead += 1;
  }

  const seen = new Set();
  pullRequest.comments = {
    nodes: allComments
      .filter((comment) => {
        const identity = commentIdentity(comment);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .sort((a, b) => String(a?.createdAt ?? '').localeCompare(String(b?.createdAt ?? ''))
        || commentIdentity(a).localeCompare(commentIdentity(b))),
    pageInfo,
  };
  return pullRequest;
}

/**
 * #1430 P1 — UNVERIFIED IS A DISTINCT REPORTED STATE, NOT A HOLD. THE REOPEN GAP IS CLOSED ELSEWHERE.
 *
 * This has now been decided twice and the second answer is the durable one, so both are recorded.
 *
 * The reopen problem is real: GitHub emits NO workflow event when a review thread is resolved or
 * unresolved, so no trigger list can refresh a green check after a reopen. I first closed that by
 * making `'unverified'` enforcement HOLD, reasoning that the repository's live enforcement was the only
 * remaining protection and an unverifiable protection must not read as qualified.
 *
 * That was wrong in practice, and the reason is decisive: `github.token` cannot read the admin surfaces
 * that reveal branch protection, and a PR-controlled workflow must never be handed `GH_PAT`. So
 * `'unverified'` is the PERMANENT state of every candidate, and holding on it deadlocks the entire
 * queue for a credential gap no candidate can fix. A gate that no candidate can ever pass is not a
 * gate; it is an outage.
 *
 * So enforcement returns to three distinct reported outcomes — enforced, not enforced, unverifiable —
 * and the reopen gap is closed by FRESHNESS instead: a qualification receipt must be produced
 * immediately before merge, and a stale receipt disqualifies. A thread reopened after a receipt was
 * written makes that receipt stale by construction, which needs no webhook and no elevated token.
 *
 * A definite `false` still disqualifies: that is a real, readable finding about the base branch, and it
 * is something a repository owner can actually fix.
 *
 * Extracted and exported deliberately: while this decision lived inline in `main()` no casualty could
 * reach it, and a mutation collapsing `unverified` back into `not_enforced` survived the suite.
 */
export function applyEnforcementToReceipt(receipt, enforcement) {
  if (enforcement === false) {
    receipt.qualified = false;
    receipt.reasons.push('review_thread_resolution_not_enforced_at_merge');
  } else if (enforcement === 'unverified') {
    // Reported, never blocking: this describes THIS RUN's credentials, not the repository, and no
    // candidate can fix it. The reopen gap it used to guard is closed by receipt freshness instead.
    receipt.warnings = [...(receipt.warnings ?? []), 'review_thread_resolution_enforcement_unverified'];
  }
  receipt.reviewThreadResolutionEnforced = enforcement;
  return receipt;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const expectedHeadSha = process.env.EXPECTED_HEAD_SHA ?? '';
  const token = process.env.GITHUB_TOKEN ?? '';
  if (!/^[^/]+\/[^/]+$/.test(repository) || !/^[0-9a-f]{40}$/i.test(expectedHeadSha) || !token) {
    console.error('NOT REVIEW-QUALIFIED: github_repository, expected_head_sha, or github_token missing');
    process.exit(1);
  }

  try {
    const { number, reviewedSha } = await resolveQualificationTarget({
      repository,
      expectedHeadSha,
      token,
      explicitNumber: process.env.PR_NUMBER,
      eventName: process.env.GITHUB_EVENT_NAME ?? '',
      baseRef: process.env.GITHUB_BASE_REF_FOR_PUSH ?? '',
    });
    const pullRequest = await readPullRequest({ repository, number, token });
    // On a push this is the reviewed head, not the pushed merge commit — see resolveQualificationTarget.
    const receipt = buildReviewReceipt({ pullRequest, expectedHeadSha: reviewedSha });
    const reviewThreadResolutionEnforced = await readReviewThreadResolutionEnforcement({
      repository,
      branch: pullRequest.baseRefName,
      token,
    });
    applyEnforcementToReceipt(receipt, reviewThreadResolutionEnforced);
    if (process.env.REVIEW_QUALIFICATION_FILE) {
      writeFileSync(process.env.REVIEW_QUALIFICATION_FILE, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    }
    console.log(formatReviewQualification(receipt));
    if (!receipt.qualified) process.exit(1);
  } catch (error) {
    console.error(`NOT REVIEW-QUALIFIED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
