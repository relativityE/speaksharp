import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReviewReceipt } from '../../scripts/collect-review-qualification.mjs';
import { guardedMerge } from '../../scripts/pre-merge-gate.mjs';
import { collectCarryForward, historicalReviewBase, patchHash } from '../../scripts/review-carry-forward.mjs';

const repository = 'sample/speech';
const oldBase = '1'.repeat(40);
const oldHead = '2'.repeat(40);
const base = '3'.repeat(40);
const head = '4'.repeat(40);
const at = minute => `2026-11-16T08:${String(minute).padStart(2, '0')}:00Z`;
const review = { reviewedSha: oldHead, completedAt: Date.parse(at(20)) };
const author = { login: 'chatgpt-codex-connector[bot]' };
function fixture(number = 72) {
  const row = label => `| ${label} | ✅ **Completed** <relative-time datetime="${at(20)}">Complete</relative-time> | \`${oldHead.slice(0, 8)}\` | Draft marked ready |`;
  const summary = [
    '<!-- codex-pull-request-review-summary -->',
    `<!-- codex-security-review:v1 ${JSON.stringify({ status: 'completed', headSha: oldHead,
      repository, pullRequestNumber: number })} -->`,
    row('📝 **Code Review**'), row('🔒 **Security Review**'),
  ].join('\n');
  return {
    number, state: 'OPEN', baseRefName: 'main', baseRefOid: base, headRefOid: head,
    baseRepository: { nameWithOwner: repository }, headRepository: { nameWithOwner: repository },
    timelineItems: { nodes: [{ createdAt: at(10) }] },
    files: { nodes: [{ path: 'tests/db/example.test.mjs' }], pageInfo: { hasNextPage: false } },
    comments: { nodes: [{ author, body: summary, createdAt: at(21) }], pageInfo: { hasPreviousPage: false } },
    reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
    reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    headRefHistory: { complete: true, moves: [
      { after: oldHead, timestamp: at(2) }, { after: head, timestamp: at(24) },
    ] },
  };
}

function runData(number) {
  const r = { id: 1234 };
  return { total_count: 1, workflow_runs: [{
    head_sha: oldHead, event: 'pull_request', path: '.github/workflows/ci.yml', created_at: at(5),
    repository: { ...r, full_name: repository },
    pull_requests: [{ number, head: { sha: oldHead, repo: r }, base: { sha: oldBase, ref: 'main', repo: r } }],
  }] };
}
const collect = async (pr, data = runData(pr.number), compare = () => ({ hash: 'a'.repeat(64), integrationBaseSha: base })) => {
  pr.reviewCarryForward = await collectCarryForward(pr, review, async () => data, compare);
  return buildReviewReceipt({ pullRequest: pr, expectedHeadSha: head });
};

describe('generic patch-bound review', () => {
  it.each([72, 193])('accepts an identical patch for PR %s with no PR-specific config', async number => {
    expect(await collect(fixture(number))).toMatchObject({ qualified: true, reviewedSha: oldHead, currentSha: head,
      reviewEvidence: 'identical_patch', reviewCarryForward: { number, integrationBaseSha: base } });
  });

  it.each(['wrong PR', 'wrong head', 'wrong workflow', 'late run', 'incomplete', 'conflicting base'])(
    'rejects historical input that cannot pin one original base: %s', defect => {
      const data = runData(72);
      const run = data.workflow_runs[0], pr = run.pull_requests[0];
      if (defect === 'wrong PR') pr.number += 1;
      if (defect === 'wrong head') pr.head.sha = base;
      if (defect === 'wrong workflow') run.path = '.github/workflows/other.yml';
      if (defect === 'late run') run.created_at = at(21);
      if (defect === 'incomplete') data.total_count += 1;
      if (defect === 'conflicting base') {
        data.total_count += 1;
        data.workflow_runs.push({ ...run, pull_requests: [{ ...pr, base: { ...pr.base, sha: base } }] });
      }
      expect(historicalReviewBase(data, { ...review, repository, number: 72 })).toBe(null);
    });

  it.each(['author', 'move during review', 'new Ready', 'incomplete read', 'old finding', 'new finding'])(
    'never clears invalid reviews or findings: %s', async defect => {
      const pr = fixture();
      if (defect === 'author') pr.comments.nodes[0].author = { login: 'relativityE' };
      if (defect === 'move during review') pr.headRefHistory.moves[1].timestamp = at(15);
      if (defect === 'new Ready') pr.timelineItems.nodes.push({ createdAt: at(25) });
      if (defect === 'incomplete read') pr.reviewThreads.pageInfo.hasNextPage = true;
      if (defect.endsWith('finding')) {
        const oid = defect === 'old finding' ? oldHead : head;
        pr.reviewThreads.nodes.push({ isResolved: false, comments: { nodes: [
          { author, body: 'P1 Badge', originalCommit: { oid } },
        ] } });
      }
      expect((await collect(pr)).qualified).toBe(false);
    });

  it('refuses a mismatching patch and requires fresh live review evidence before the mock merge', async () => {
    expect((await collect(fixture(), runData(72), () => null)).qualified).toBe(false);
    const pr = fixture();
    const receipt = await collect(pr);
    let calls = 0;
    const args = {
      repository, prNumber: 72, expectedHeadSha: head, expectedBaseSha: base,
      priorReceipt: receipt, readPullRequest: async () => pr, readBaseProtection: async () => 'enforced',
      mergeExecutor: async () => { calls += 1; },
    };
    expect((await guardedMerge({ ...args, priorReceipt: { ...receipt, generatedAt: '2000-01-01T00:00:00Z' } })).mergeInvoked).toBe(false);
    expect((await guardedMerge({ ...args, expectedBaseSha: oldBase })).mergeInvoked).toBe(false);
    expect((await guardedMerge({ ...args, readPullRequest: async () => fixture() })).mergeInvoked).toBe(false);
    expect((await guardedMerge({ ...args, priorReceipt: { ...receipt,
      reviewCarryForward: { ...receipt.reviewCarryForward, hash: 'b'.repeat(64) },
    } })).mergeInvoked).toBe(false);
    expect(calls).toBe(0);
    expect((await guardedMerge(args)).merged).toBe(true);
    expect(calls).toBe(1);
  });

  it('hashes only changed paths and detects content, executable mode and extra changes using actual Git commits', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'review-patch-test-'));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (path, value) => writeFileSync(join(cwd, path), value);
    const commit = message => {
      git('add', '-A');
      git('commit', '-qm', message);
      return git('rev-parse', 'HEAD');
    };
    try {
      git('init', '-q'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
      write('changed', 'before'); write('not-changed', 'old'); const b1 = commit('base');
      write('changed', 'after'); const h1 = commit('reviewed');
      git('checkout', '-q', '--detach', b1);
      write('not-changed', 'updates on main'); const b2 = commit('new base');
      write('changed', 'after'); const h2 = commit('same patch on different base');
      const original = patchHash(cwd, b1, h1);
      expect(patchHash(cwd, b2, h2)).toBe(original);
      write('changed', 'different'); expect(patchHash(cwd, b2, commit('altered after'))).not.toBe(original);
      write('changed', 'after'); chmodSync(join(cwd, 'changed'), 0o755);
      expect(patchHash(cwd, b2, commit('altered mode'))).not.toBe(original);
      chmodSync(join(cwd, 'changed'), 0o644); write('more', 'extra path');
      expect(patchHash(cwd, b2, commit('extra path'))).not.toBe(original);
      expect(patchHash(cwd, b2, b2)).toBe(null);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
