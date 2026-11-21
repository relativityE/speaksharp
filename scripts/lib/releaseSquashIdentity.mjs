// Structural checks only. Fetch the push and Git objects from GitHub; supply
// approval only from a verified, independent authority, never the new tree.
const SHA = /^[0-9a-f]{40}$/;
const VERSION_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/;
const REPO = 'relativityE/speaksharp';
const MAIN = 'refs/heads/main';

export function verifyReleaseSquashIdentity({ push, before, after, approval, baselineTag } = {}) {
  if (push?.repository?.full_name !== REPO || push.ref !== MAIN || push.forced !== true
      || push.created !== false || push.deleted !== false) return { ok: false, reason: 'not-forced-main-push' };
  if (![push.before, push.after, before?.tree?.sha, after?.tree?.sha].every(
    (value) => typeof value === 'string' && SHA.test(value) && !/^0+$/.test(value),
  ) || push.before === push.after || before?.sha !== push.before || after?.sha !== push.after) {
    return { ok: false, reason: 'commit-identity-mismatch' };
  }
  if (approval?.repository !== REPO || approval.ref !== MAIN
      || approval.before !== push.before || approval.after !== push.after
      || typeof approval.baselineTag !== 'string' || !VERSION_TAG.test(approval.baselineTag)
      || typeof approval.baselineSha !== 'string' || !SHA.test(approval.baselineSha)) {
    return { ok: false, reason: 'approval-identity-mismatch' };
  }
  if (baselineTag?.ref !== `refs/tags/${approval.baselineTag}` || baselineTag?.commit !== approval.baselineSha
      || !Array.isArray(after.parents) || after.parents.length !== 1 || after.parents[0]?.sha !== approval.baselineSha
      || push.before === approval.baselineSha || push.after === approval.baselineSha) {
    return { ok: false, reason: 'baseline-parent-mismatch' };
  }
  if (before.tree.sha !== after.tree.sha) return { ok: false, reason: 'tree-mismatch' };
  return { ok: true, beforeSha: push.before, afterSha: push.after, treeSha: after.tree.sha };
}
