#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluateReviewQualification, formatReviewQualification } from './review-qualification.mjs';

const CODEX_LOGINS = new Set(['chatgpt-codex-connector', 'chatgpt-codex-connector[bot]']);
const RELEASE_FINDING = /P[012]\s+Badge|\bP[012]\b/i;

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
  };
}

export function reviewThreadResolutionIsEnforced({ branchProtection, branchRules }) {
  if (branchProtection?.required_conversation_resolution?.enabled === true) return true;
  return Array.isArray(branchRules) && branchRules.some((rule) =>
    rule?.type === 'pull_request'
    && rule?.parameters?.required_review_thread_resolution === true);
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

async function optionalGithubRequest(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(`github_api_${response.status}`);
  return response.json();
}

async function readReviewThreadResolutionEnforcement({ repository, branch, token }) {
  const encodedBranch = encodeURIComponent(branch);
  const [branchProtection, branchRules] = await Promise.all([
    optionalGithubRequest(`/repos/${repository}/branches/${encodedBranch}/protection`, token),
    optionalGithubRequest(`/repos/${repository}/rules/branches/${encodedBranch}?per_page=100`, token),
  ]);
  return reviewThreadResolutionIsEnforced({ branchProtection, branchRules });
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
    if (!reviewThreadResolutionEnforced) {
      receipt.qualified = false;
      receipt.reasons.push('review_thread_resolution_not_enforced_at_merge');
    }
    receipt.reviewThreadResolutionEnforced = reviewThreadResolutionEnforced;
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
