import { describe, expect, it } from 'vitest';
import { verifyReleaseSquashIdentity } from '../../scripts/lib/releaseSquashIdentity.mjs';

const repository = 'relativityE/speaksharp';
const ref = 'refs/heads/main';
const baseline = 'df909805947d4ecc245692cff491515a1b6c6345';
const old = '1'.repeat(40);
const next = '2'.repeat(40);
const tree = '3'.repeat(40);
const fixture = () => ({
  push: { repository: { full_name: repository }, ref, forced: true, created: false, deleted: false, before: old, after: next },
  before: { sha: old, tree: { sha: tree } },
  after: { sha: next, tree: { sha: tree }, parents: [{ sha: baseline }] },
  approval: { repository, ref, before: old, after: next, baselineTag: 'v0.9.0-rc4', baselineSha: baseline },
  baselineTag: { ref: 'refs/tags/v0.9.0-rc4', commit: baseline },
});

describe('the one-time main squash structural check', () => {
  it('binds the approval, real push, commit and tree identities', () => {
    expect(verifyReleaseSquashIdentity(fixture())).toEqual({ ok: true, beforeSha: old, afterSha: next, treeSha: tree });
  });

  it('accepts an owner-selected later squash checkpoint instead of guessing the latest release', () => {
    const f = fixture();
    const checkpoint = 'be858abc166a844db77d29706c4a75d01d0f7b43';
    f.after.parents = [{ sha: checkpoint }];
    f.approval.baselineSha = checkpoint;
    f.approval.baselineTag = 'v0.9.5-rc0-pre-cloud-native-removal';
    f.baselineTag = { ref: 'refs/tags/v0.9.5-rc0-pre-cloud-native-removal', commit: checkpoint };
    expect(verifyReleaseSquashIdentity(f).ok).toBe(true);
  });

  it.each([
    ['unapproved push with a forged trailer', (f) => {
      f.approval = undefined;
      f.after.message = 'Squash-Of: ' + old;
    }, 'approval-identity-mismatch'],
    ['approval for another new commit', (f) => { f.approval.after = '4'.repeat(40); }, 'approval-identity-mismatch'],
    ['approval for an older main', (f) => { f.approval.before = '4'.repeat(40); }, 'approval-identity-mismatch'],
    ['different tree', (f) => { f.after.tree.sha = '4'.repeat(40); }, 'tree-mismatch'],
    ['two parents', (f) => { f.after.parents.push({ sha: old }); }, 'baseline-parent-mismatch'],
    ['different tag at the same baseline commit', (f) => { f.baselineTag.ref = 'refs/tags/v0.9.0-rc3'; }, 'baseline-parent-mismatch'],
    ['baseline is not a tag', (f) => { f.approval.baselineTag = 'main'; }, 'approval-identity-mismatch'],
    ['baseline moved', (f) => { f.baselineTag.commit = '4'.repeat(40); }, 'baseline-parent-mismatch'],
    ['wrong parent', (f) => { f.after.parents[0].sha = old; }, 'baseline-parent-mismatch'],
    ['wrong pushed ref', (f) => { f.push.ref = 'refs/heads/other'; }, 'not-forced-main-push'],
    ['normal push', (f) => { f.push.forced = false; }, 'not-forced-main-push'],
    ['checkout is not the pushed object', (f) => { f.after.sha = old; }, 'commit-identity-mismatch'],
  ])('refuses %s', (_name, change, reason) => {
    const input = fixture();
    change(input);
    expect(verifyReleaseSquashIdentity(input)).toEqual({ ok: false, reason });
  });
});
