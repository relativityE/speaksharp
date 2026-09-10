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

async function resolvePullRequestNumber({ repository, expectedHeadSha, token, explicitNumber }) {
  if (/^[1-9]\d*$/.test(explicitNumber ?? '')) return Number(explicitNumber);
  const candidates = await githubRequest(`/repos/${repository}/commits/${expectedHeadSha}/pulls`, token);
  const matching = candidates.filter((pull) => pull.state === 'open' && pull.head?.sha?.toLowerCase() === expectedHeadSha.toLowerCase());
  if (matching.length !== 1) throw new Error(`expected_one_open_pr_for_head:${matching.length}`);
  return matching[0].number;
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
 * #1430 P1 — UNVERIFIED IS REPORTED, NOT BLOCKING.
 *
 * A definite `false` is a real finding about the base branch and still disqualifies the head. An
 * `'unverified'` is a statement about THIS RUN's credentials, not about the repository, and failing
 * the gate on it makes every candidate unqualifiable for a reason no candidate can fix. It is
 * surfaced on the receipt so the gap stays visible and auditable rather than silent.
 *
 * Extracted and exported deliberately: while this decision lived inline in `main()` no casualty could
 * reach it, and a mutation collapsing `unverified` back into `not_enforced` survived the suite.
 */
export function applyEnforcementToReceipt(receipt, enforcement) {
  if (enforcement === false) {
    receipt.qualified = false;
    receipt.reasons.push('review_thread_resolution_not_enforced_at_merge');
  } else if (enforcement === 'unverified') {
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
    const number = await resolvePullRequestNumber({
      repository,
      expectedHeadSha,
      token,
      explicitNumber: process.env.PR_NUMBER,
    });
    const pullRequest = await readPullRequest({ repository, number, token });
    const receipt = buildReviewReceipt({ pullRequest, expectedHeadSha });
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
