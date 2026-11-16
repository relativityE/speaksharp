// Bounded first use of patch-bound review. These are the pre/post Git objects
// from the original qualified #1871 review (run 43775643409), not PR inputs.
export const REVIEW_CARRY_PILOT = Object.freeze({
  repository: 'relativityE/speaksharp',
  number: 1871,
  reviewedSha: 'b66cb64bed8109e610e994e3ed63e9d43cc3b8d4',
  reviewedBaseSha: '96a64cafc5c1da97ea2c289b23c50ad83d46ba5e',
  path: 'tests/db/rwt-feedback-fence-realpg.test.mjs',
  before: '100644:blob:364f5843e4c7f888d80bb66145c7dbfeac02114e',
  after: '100644:blob:bc6c97c12cb6e4adfba74008f0dffd04fda75ed4',
});

const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

function leaves(tree, expected) {
  if (!sha(expected) || tree?.sha !== expected || tree.truncated !== false || !Array.isArray(tree.tree)) return null;
  const result = new Map();
  for (const row of tree.tree) {
    if (typeof row?.path !== 'string' || !row.path || result.has(row.path) || !sha(row.sha)) return null;
    // A directory's ID changes with its children; its existence and mode must not.
    if (row.type === 'tree' && row.mode === '040000') {
      result.set(row.path, '040000:tree');
      continue;
    }
    if (!/^(100644|100755|120000):blob$|^160000:commit$/.test(`${row.mode}:${row.type}`)) return null;
    result.set(row.path, `${row.mode}:${row.type}:${row.sha}`);
  }
  return result;
}

export function sameReviewedPatch({ baseTree, headTree, baseTreeSha, headTreeSha }) {
  const { path, before, after } = REVIEW_CARRY_PILOT;
  const base = leaves(baseTree, baseTreeSha);
  const head = leaves(headTree, headTreeSha);
  if (base?.get(path) !== before || head?.get(path) !== after || base.size !== head.size) return false;
  return [...base].every(([name, entry]) => name === path || head.get(name) === entry);
}

export function isPilotPullRequest(pr) {
  const { repository, number, path } = REVIEW_CARRY_PILOT;
  return pr?.number === number && pr.baseRefName === 'main'
    && pr.baseRepository?.nameWithOwner === repository && pr.headRepository?.nameWithOwner === repository
    && sha(pr.headRefOid) && sha(pr.baseRefOid)
    && pr.files?.pageInfo?.hasNextPage === false && pr.files.nodes?.length === 1
    && pr.files.nodes[0]?.path === path;
}

export function carryForwardBound(receipt) {
  const { repository, number, reviewedSha, reviewedBaseSha } = REVIEW_CARRY_PILOT;
  const proof = receipt?.reviewCarryForward;
  return receipt?.reviewEvidence === 'identical_patch' && receipt.repository === repository
    && receipt.pullRequestNumber === number && receipt.reviewedSha === reviewedSha
    && sha(receipt.currentSha) && receipt.currentSha !== reviewedSha && sha(receipt.baseSha)
    && proof?.reviewedBaseSha === reviewedBaseSha && proof.headSha === receipt.currentSha
    && proof.prBaseSha === receipt.baseSha && sha(proof.integrationBaseSha);
}

export async function collectCarryForward(pr, github) {
  const { repository, reviewedSha, reviewedBaseSha } = REVIEW_CARRY_PILOT;
  if (!isPilotPullRequest(pr) || pr.headRefOid === reviewedSha) return null;
  const readCommit = id => github(`/repos/${repository}/git/commits/${id}`);
  const merged = pr.state === 'MERGED';
  if (!merged && pr.state !== 'OPEN') return null;
  const integration = merged && sha(pr.mergeCommit?.oid) ? await readCommit(pr.mergeCommit.oid) : null;
  if (merged && (integration?.sha !== pr.mergeCommit?.oid || integration?.parents?.length !== 1)) return null;
  const integrationBaseSha = merged ? integration.parents[0]?.sha : pr.baseRefOid;
  if (!sha(integrationBaseSha)) return null;
  const [base, head] = await Promise.all([readCommit(integrationBaseSha), readCommit(pr.headRefOid)]);
  if (base?.sha !== integrationBaseSha || head?.sha !== pr.headRefOid
      || head.parents?.length !== 1 || head.parents[0]?.sha !== integrationBaseSha
      || !sha(base.tree?.sha) || !sha(head.tree?.sha)
      || (merged && integration.tree?.sha !== head.tree.sha)) return null;
  const readTree = id => github(`/repos/${repository}/git/trees/${id}?recursive=1`);
  const [baseTree, headTree] = await Promise.all([readTree(base.tree.sha), readTree(head.tree.sha)]);
  if (!sameReviewedPatch({ baseTree, headTree, baseTreeSha: base.tree.sha, headTreeSha: head.tree.sha })) return null;
  return { reviewedBaseSha, headSha: pr.headRefOid, prBaseSha: pr.baseRefOid, integrationBaseSha };
}
