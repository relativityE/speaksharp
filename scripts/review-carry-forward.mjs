// The digest covers the changed paths, modes and Git objects, never the branch or commit name.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const repoName = value => typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value);
const MAIN_REF = 'refs/heads/main';
const MAX_ACTIVITY = 100;
const ADVANCE_TYPES = new Set(['push', 'pr_merge', 'merge_queue_merge']);

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

// Actions run associations describe the current PR, not its historical base. GitHub's repository
// activity instead records each main movement's actual before/after, independently of this PR.
export function historicalReviewBase(activity, { liveBaseSha, mergeSha = null, readyAt, completedAt }) {
  if (!Array.isArray(activity) || activity.length === 0 || activity.length > MAX_ACTIVITY
    || !sha(liveBaseSha) || (mergeSha !== null && !sha(mergeSha))
    || !Number.isFinite(readyAt) || !Number.isFinite(completedAt) || completedAt <= readyAt) return null;
  // An open candidate's activity must start at the live main read with its PR. A merged
  // candidate's baseRefOid may be historical; anchor to its recorded squash in the linked prefix.
  let expected = mergeSha === null ? liveBaseSha : activity[0]?.after;
  let sawMerge = mergeSha === null;
  let lastTime = Infinity;
  const seen = new Set();
  for (const entry of activity) {
    const { before, after, ref, activity_type: type, timestamp } = entry ?? {};
    const time = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
    if (ref !== MAIN_REF || !ADVANCE_TYPES.has(type) || !sha(before) || !sha(after)
      || before === '0'.repeat(40) || after === '0'.repeat(40) || before === after
      || after !== expected || !Number.isFinite(time) || time >= lastTime
      || seen.has(after) || seen.has(before)) return null;
    seen.add(after);
    if (after === mergeSha && time > completedAt) sawMerge = true;
    if (time < readyAt) return sawMerge ? after : null;
    if (time <= completedAt) return null; // Main moved during the review or in a tied second.
    expected = before;
    lastTime = time;
  }
  // Older pagination can't affect a base already found in this contiguous prefix. Without
  // that pre-Ready record in the bounded page, there is no historical evidence to use.
  return null;
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
  const activity = await github(`/repos/${repository}/activity?ref=${encodeURIComponent(MAIN_REF)}&per_page=${MAX_ACTIVITY}&direction=desc`);
  const reviewedBaseSha = historicalReviewBase(activity, {
    liveBaseSha: pr.baseRefOid, mergeSha, readyAt: review.readyAt, completedAt: review.completedAt,
  });
  if (!reviewedBaseSha) return null;
  const binding = { repository, number, reviewedSha, reviewedBaseSha, headSha: pr.headRefOid, prBaseSha: pr.baseRefOid };
  const proof = compare({ ...binding, mergeSha });
  return proof ? { ...binding, ...proof } : null;
}
