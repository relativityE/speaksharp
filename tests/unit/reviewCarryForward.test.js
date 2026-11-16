import { describe, expect, it } from 'vitest';
import { buildReviewReceipt } from '../../scripts/collect-review-qualification.mjs';
import { guardedMerge } from '../../scripts/pre-merge-gate.mjs';
import { collectCarryForward, REVIEW_CARRY_PILOT as pilot } from '../../scripts/review-carry-forward.mjs';

const base = '1'.repeat(40);
const head = '2'.repeat(40);
const baseTree = '3'.repeat(40);
const headTree = '4'.repeat(40);
const squash = '5'.repeat(40);
const at = minute => `2026-11-16T08:${String(minute).padStart(2, '0')}:00Z`;
const author = { login: 'chatgpt-codex-connector[bot]' };
const receiptRow = label => `| ${label} | ✅ **Completed** <relative-time datetime="${at(20)}">Complete</relative-time> | \`${pilot.reviewedSha.slice(0, 8)}\` | Draft marked ready |`;
const summary = [
  '<!-- codex-pull-request-review-summary -->',
  `<!-- codex-security-review:v1 ${JSON.stringify({ status: 'completed', headSha: pilot.reviewedSha,
    repository: pilot.repository, pullRequestNumber: pilot.number })} -->`,
  receiptRow('📝 **Code Review**'),
  receiptRow('🔒 **Security Review**'),
].join('\n');
const fixture = () => ({
  number: pilot.number, state: 'OPEN', baseRefName: 'main', baseRefOid: base, headRefOid: head,
  baseRepository: { nameWithOwner: pilot.repository }, headRepository: { nameWithOwner: pilot.repository },
  timelineItems: { nodes: [{ createdAt: at(10) }] },
  files: { nodes: [{ path: pilot.path }], pageInfo: { hasNextPage: false } },
  comments: { nodes: [{ author, body: summary, createdAt: at(21) }], pageInfo: { hasPreviousPage: false } },
  reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
  reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
  headRefHistory: { complete: true, moves: [
    { after: pilot.reviewedSha, timestamp: at(2) }, { after: head, timestamp: at(24) },
  ] },
});
const entry = (path, object) => {
  const [mode, type, sha] = object.split(':');
  return { path, mode, type, sha };
};
function gitObjects() {
  const git = `/repos/${pilot.repository}/git/`;
  const common = entry('unchanged.mjs', '100644:blob:' + '6'.repeat(40));
  return {
    [`${git}commits/${base}`]: { sha: base, tree: { sha: baseTree } },
    [`${git}commits/${head}`]: { sha: head, tree: { sha: headTree }, parents: [{ sha: base }] },
    [`${git}commits/${squash}`]: { sha: squash, tree: { sha: headTree }, parents: [{ sha: base }] },
    [`${git}trees/${baseTree}?recursive=1`]: { sha: baseTree, truncated: false, tree: [entry(pilot.path, pilot.before), common] },
    [`${git}trees/${headTree}?recursive=1`]: { sha: headTree, truncated: false, tree: [entry(pilot.path, pilot.after), { ...common }] },
  };
}
const gitRead = objects => async path => objects[path];
const collect = async (pr = fixture(), objects = gitObjects()) => {
  pr.reviewCarryForward = await collectCarryForward(pr, gitRead(objects));
  return buildReviewReceipt({ pullRequest: pr, expectedHeadSha: head });
};

describe('carry #1871 review only when the complete patch is identical', () => {
  it('retains the original review SHA, not a claim that the refreshed head was reviewed', async () => {
    const pr = fixture();
    expect(buildReviewReceipt({ pullRequest: pr, expectedHeadSha: head }).qualified).toBe(false);
    expect(await collect(pr)).toMatchObject({ qualified: true, currentSha: head, reviewedSha: pilot.reviewedSha,
      reviewEvidence: 'identical_patch', reviewCarryForward: { integrationBaseSha: base } });
  });

  it.each(['before', 'after', 'mode', 'second path', 'truncated', 'old base', 'unrelated PR'])(
    'refuses changed or incomplete Git evidence: %s', async defect => {
      const pr = fixture();
      const objects = gitObjects();
      const git = `/repos/${pilot.repository}/git/`;
      const b = objects[`${git}trees/${baseTree}?recursive=1`];
      const h = objects[`${git}trees/${headTree}?recursive=1`];
      if (defect === 'before') b.tree[0].sha = 'a'.repeat(40);
      if (defect === 'after') h.tree[0].sha = 'b'.repeat(40);
      if (defect === 'mode') h.tree[0].mode = '100755';
      if (defect === 'second path') h.tree[1].sha = 'c'.repeat(40);
      if (defect === 'truncated') h.truncated = true;
      if (defect === 'old base') objects[`${git}commits/${head}`].parents = [{ sha: pilot.reviewedBaseSha }];
      if (defect === 'unrelated PR') pr.number += 1;
      expect((await collect(pr, objects)).qualified).toBe(false);
    },
  );

  it.each(['author', 'move during review', 'new Ready', 'incomplete read', 'old finding', 'new finding'])(
    'refuses invalid original proof or current blockers: %s', async defect => {
      const pr = fixture();
      if (defect === 'author') pr.comments.nodes[0].author = { login: 'relativityE' };
      if (defect === 'move during review') pr.headRefHistory.moves[1].timestamp = at(15);
      if (defect === 'new Ready') pr.timelineItems.nodes.push({ createdAt: at(25) });
      if (defect === 'incomplete read') pr.reviewThreads.pageInfo.hasNextPage = true;
      if (defect.endsWith('finding')) {
        const oid = defect === 'old finding' ? pilot.reviewedSha : head;
        pr.reviewThreads.nodes.push({ isResolved: false, comments: { nodes: [
          { author, body: 'P1 Badge', originalCommit: { oid } },
        ] } });
      }
      expect((await collect(pr)).qualified).toBe(false);
    },
  );

  it('rebinds post-merge verification to the actual squash parent and exact integrated tree', async () => {
    const pr = { ...fixture(), state: 'MERGED', mergeCommit: { oid: squash }, baseRefOid: squash };
    const objects = gitObjects();
    expect((await collect(pr, objects)).qualified).toBe(true);
    objects[`/repos/${pilot.repository}/git/commits/${squash}`].tree.sha = baseTree;
    expect((await collect(pr, objects)).qualified).toBe(false);
  });

  it('requires a fresh bound receipt and independently read live evidence before invoking the mock merge', async () => {
    const pr = fixture();
    const receipt = await collect(pr);
    let calls = 0;
    const args = {
      repository: pilot.repository, prNumber: pilot.number, expectedHeadSha: head, expectedBaseSha: base,
      priorReceipt: receipt, readPullRequest: async () => pr, readBaseProtection: async () => 'enforced',
      mergeExecutor: async () => { calls += 1; },
    };
    expect((await guardedMerge({ ...args, priorReceipt: { ...receipt, generatedAt: '2000-01-01T00:00:00Z' } })).mergeInvoked).toBe(false);
    expect((await guardedMerge({ ...args, expectedBaseSha: squash })).mergeInvoked).toBe(false);
    expect((await guardedMerge({ ...args, readPullRequest: async () => fixture() })).mergeInvoked).toBe(false);
    expect(calls).toBe(0);
    expect((await guardedMerge(args)).merged).toBe(true);
    expect(calls).toBe(1);
  });
});
