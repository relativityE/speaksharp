// The digest covers the changed paths, modes and Git objects, never the branch or commit name.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const repoName = value => typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value);
const MAX_RUNS = 30;

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw Error('patch_git_evidence_unavailable');
  return result.stdout;
}

export function patchHash(cwd, base, head) {
  if (!sha(base) || !sha(head)) throw Error('invalid_patch_ref');
  const changed = git(cwd, 'diff-tree', '--no-commit-id', '--raw', '-r', '--no-abbrev', '--no-renames', '-z', base, head);
  if (changed.length === 0) return null;
  return createHash('sha256').update('speaksharp-patch-v1\0').update(changed).digest('hex');
}

// Compare in a fresh Git directory, never running anything from either candidate.
function compareGit({ repository, reviewedBaseSha, reviewedSha, headSha, prBaseSha, mergeSha }) {
  const dir = mkdtempSync(join(tmpdir(), 'speaksharp-patch-'));
  try {
    git(dir, 'init', '-q');
    const pinned = [...new Set([reviewedBaseSha, reviewedSha, headSha, mergeSha ?? prBaseSha])];
    git(dir, 'fetch', '-q', '--filter=blob:none', '--no-tags', '--depth=64', `https://github.com/${repository}.git`, ...pinned);
    const parents = shaValue => git(dir, 'cat-file', '-p', shaValue).toString().split('\n\n')[0]
      .split('\n').filter(line => line.startsWith('parent ')).map(line => line.slice(7));
    const squashParents = mergeSha ? parents(mergeSha) : [];
    if (mergeSha && (squashParents.length !== 1
      || !git(dir, 'rev-parse', `${mergeSha}^{tree}`).equals(git(dir, 'rev-parse', `${headSha}^{tree}`)))) return null;
    const integrationBaseSha = mergeSha ? squashParents[0] : prBaseSha;
    if (mergeSha) git(dir, 'fetch', '-q', '--filter=blob:none', '--no-tags', '--depth=64',
      `https://github.com/${repository}.git`, integrationBaseSha);
    git(dir, 'merge-base', '--is-ancestor', reviewedBaseSha, reviewedSha);
    git(dir, 'merge-base', '--is-ancestor', integrationBaseSha, headSha);
    // Another PR may have landed part of the reviewed change in the meantime.
    // Don't silently shrink the original review to whatever still differs.
    if (git(dir, 'merge-base', '--all', reviewedSha, integrationBaseSha).toString().trim() !== reviewedBaseSha) return null;
    const original = patchHash(dir, reviewedBaseSha, reviewedSha);
    const current = patchHash(dir, integrationBaseSha, headSha);
    return original && original === current ? { hash: original, integrationBaseSha } : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The old base comes from GitHub's PR-event record, not a branch, author comment, or candidate receipt.
export function historicalReviewBase(data, { repository, number, reviewedSha, completedAt }) {
  if (!Number.isInteger(data?.total_count) || data.total_count < 1 || data.total_count > MAX_RUNS
    || data.workflow_runs?.length !== data.total_count || !Number.isFinite(completedAt)) return null;
  const bases = new Set();
  for (const run of data.workflow_runs) {
    if (run?.head_sha !== reviewedSha || run?.event !== 'pull_request' || run?.path !== '.github/workflows/ci.yml'
      || run.repository?.full_name !== repository || !Number.isSafeInteger(run.repository.id)) return null;
    const time = Date.parse(run.created_at ?? '');
    if (!Number.isFinite(time)) return null;
    if (time > completedAt) continue;
    const prs = run.pull_requests?.filter(pr => pr.number === number);
    if (!prs || prs.length > 1) return null;
    if (!prs.length) continue;
    const { head, base } = prs[0];
    if (head?.sha !== reviewedSha || base?.ref !== 'main' || !sha(base?.sha)
      || head.repo?.id !== run.repository.id || base.repo?.id !== run.repository.id) return null;
    bases.add(base.sha);
  }
  return bases.size === 1 ? [...bases][0] : null;
}

export function carryForwardBound(receipt) {
  const proof = receipt?.reviewCarryForward;
  return receipt?.reviewEvidence === 'identical_patch' && repoName(receipt.repository)
    && Number.isSafeInteger(receipt.pullRequestNumber) && sha(receipt.reviewedSha)
    && sha(receipt.currentSha) && receipt.currentSha !== receipt.reviewedSha && sha(receipt.baseSha)
    && proof?.repository === receipt.repository && proof.number === receipt.pullRequestNumber
    && proof.reviewedSha === receipt.reviewedSha && sha(proof.reviewedBaseSha) && digest(proof.hash)
    && proof.headSha === receipt.currentSha && proof.prBaseSha === receipt.baseSha && sha(proof.integrationBaseSha);
}

export async function collectCarryForward(pr, review, github, compare = compareGit) {
  const repository = pr.baseRepository?.nameWithOwner;
  const number = pr.number, reviewedSha = review?.reviewedSha;
  if (!repoName(repository) || pr.headRepository?.nameWithOwner !== repository || pr.baseRefName !== 'main'
    || !Number.isSafeInteger(number) || !sha(reviewedSha) || !sha(pr.headRefOid) || !sha(pr.baseRefOid)
    || reviewedSha === pr.headRefOid || !['OPEN', 'MERGED'].includes(pr.state)) return null;
  const mergeSha = pr.state === 'MERGED' ? pr.mergeCommit?.oid : null;
  if (pr.state === 'MERGED' && !sha(mergeSha)) return null;
  const data = await github(`/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${reviewedSha}&event=pull_request&per_page=${MAX_RUNS}`);
  const reviewedBaseSha = historicalReviewBase(data, { repository, number, reviewedSha, completedAt: review.completedAt });
  if (!reviewedBaseSha) return null;
  const binding = { repository, number, reviewedSha, reviewedBaseSha, headSha: pr.headRefOid, prBaseSha: pr.baseRefOid };
  const proof = compare({ ...binding, mergeSha });
  return proof ? { ...binding, ...proof } : null;
}
