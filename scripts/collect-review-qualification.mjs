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

function isCodex(login) {
  return CODEX_LOGINS.has(String(login ?? '').toLowerCase());
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

  const reviews = (pullRequest?.reviews?.nodes ?? [])
    .filter((review) => isCodex(review?.author?.login) && review?.state !== 'DISMISSED' && review?.commit?.oid?.toLowerCase?.() === head)
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const latest = reviews.at(-1);
  const threadFindings = (pullRequest?.reviewThreads?.nodes ?? []).filter((thread) =>
    thread?.isResolved === false
    && (thread?.comments?.nodes ?? []).some((comment) =>
      isCodex(comment?.author?.login)
      && (comment?.pullRequestReview?.commit?.oid ?? comment?.originalCommit?.oid ?? comment?.commit?.oid)?.toLowerCase?.() === head
      && RELEASE_FINDING.test(comment?.body ?? '')));
  const reviewBodyFindings = reviews.filter((review) => RELEASE_FINDING.test(review?.body ?? ''));
  const blockingReviews = reviews.filter((review) => review?.state === 'CHANGES_REQUESTED');
  const findingCount = threadFindings.length + reviewBodyFindings.length + blockingReviews.length;
  // Counted for the receipt only — never added to `findingCount`, which is what gates qualification.
  const advisoryCount = (pullRequest?.reviewThreads?.nodes ?? []).filter((thread) =>
    thread?.isResolved === false
    && (thread?.comments?.nodes ?? []).some((comment) =>
      isCodex(comment?.author?.login)
      && (comment?.pullRequestReview?.commit?.oid ?? comment?.originalCommit?.oid ?? comment?.commit?.oid)?.toLowerCase?.() === head
      && ADVISORY_FINDING.test(comment?.body ?? ''))).length;

  const evaluated = evaluateReviewQualification({
    currentSha: head,
    // #1430 P1 — stamped so a merge decision can require a receipt produced immediately beforehand.
    // A thread reopened after this moment makes this receipt stale, which is how the reopen gap is
    // closed without a webhook.
    generatedAt: new Date().toISOString(),
    reviewedSha: latest?.commit?.oid,
    reviewStatus: latest && blockingReviews.length === 0 ? 'completed' : latest ? 'changes_requested' : 'missing',
    findingCount,
    changedFiles: (pullRequest?.files?.nodes ?? []).map(({ path }) => path),
  });
  return {
    ...evaluated,
    qualified: evaluated.qualified && reasons.length === 0,
    reasons: [...reasons, ...evaluated.reasons],
    pullRequestNumber: pullRequest?.number ?? null,
    reviewSubmittedAt: latest?.submittedAt ?? null,
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

async function readPullRequest({ repository, number, token }) {
  const [owner, name] = repository.split('/');
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number headRefOid baseRefName files(first:100){nodes{path} pageInfo{hasNextPage}} reviews(last:100){nodes{author{login} state commit{oid} body submittedAt} pageInfo{hasPreviousPage}} reviewThreads(first:100){nodes{isResolved comments(last:100){nodes{author{login} body commit{oid} originalCommit{oid} pullRequestReview{commit{oid}}} pageInfo{hasPreviousPage}}} pageInfo{hasNextPage}}}}}`;
  const payload = await githubRequest('/graphql', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { owner, name, number } }),
  });
  if (payload.errors?.length || !payload.data?.repository?.pullRequest) throw new Error('github_graphql_pull_request_unavailable');
  return payload.data.repository.pullRequest;
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
