import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateReviewQualification } from '../../scripts/review-qualification.mjs';
import { buildReviewReceipt, readPullRequest } from '../../scripts/collect-review-qualification.mjs';

const HEAD = '985e45332313b2aaf27f9581e0df42be26e618df';
const BASE = '8a79eafa23bd3beeee6d087270acd9ed5a16eb1e';
const TREE = 'f04e4e4a2cb1e8cdd9d10b0f4957c6a2a7f39b6d';
const REPO = 'relativityE/speaksharp';
// Independently frozen from git ls-tree of the source-reviewed published 985e head.
const PINS = [
  {
    "path": ".agent/workflows/pr-merge-workflow.md",
    "oid": "6a0e8a9127e8a00c49b8fa8dfb55a97312015399",
    "mode": "100644",
    "size": 11491
  },
  {
    "path": "AGENTS.md",
    "oid": "6adc37f6b874df6ea513e157f4b788b0ace5aa5c",
    "mode": "100644",
    "size": 29891
  },
  {
    "path": "README.md",
    "oid": "793f8ce534980a7320ae50bd557c309a5d88ba7c",
    "mode": "100644",
    "size": 16244
  },
  {
    "path": "product_release/ARCHITECTURE.md",
    "oid": "48aa2d5dcea5e790754547ebff574ff85dd1cd30",
    "mode": "100644",
    "size": 26812
  },
  {
    "path": "product_release/ENTITLEMENTS_AND_BILLING.md",
    "oid": "de07d38ce125e686472016dbc3cae351ba762db0",
    "mode": "100644",
    "size": 12084
  },
  {
    "path": "product_release/EVIDENCE_INDEX.md",
    "oid": "14af5505758f054683036cdfee2e224fa156f084",
    "mode": "100644",
    "size": 60792
  },
  {
    "path": "product_release/OPERATIONS_AND_SECURITY.md",
    "oid": "597c259a314c8bd7e0fa8a4c992716f14828d988",
    "mode": "100644",
    "size": 48016
  },
  {
    "path": "product_release/PRODUCT_REQUIREMENTS.md",
    "oid": "510662d2f8cc5c5a23c1abc25b36e460dd476245",
    "mode": "100644",
    "size": 25659
  },
  {
    "path": "product_release/PROGRESS_AND_NEXT_ACTION.md",
    "oid": "538107fa8560f1fbdf32bd3e3c37b0a59b92f67d",
    "mode": "100644",
    "size": 27269
  },
  {
    "path": "product_release/QUALITY.md",
    "oid": "697a015eddf84345e435b6453a5310cdd7718d67",
    "mode": "100644",
    "size": 40229
  },
  {
    "path": "product_release/README.md",
    "oid": "414134476c46a3827af3f8f7634eb299e051d84a",
    "mode": "100644",
    "size": 18306
  },
  {
    "path": "product_release/RELEASE_PROCESS.md",
    "oid": "fa0c5dbdd976090bdaf4f787b2b5c35898bb0ffc",
    "mode": "100644",
    "size": 46686
  },
  {
    "path": "product_release/RELEASE_STATUS.md",
    "oid": "cb7ef279d39e6022002cfcff38d7135b254a4ee9",
    "mode": "100644",
    "size": 54396
  },
  {
    "path": "product_release/ROADMAP.md",
    "oid": "f2ff24fa57fd6a3c879aba32c898019fa60fdf21",
    "mode": "100644",
    "size": 22999
  },
  {
    "path": "product_release/STT.md",
    "oid": "74eedae8219d8e5a277838f7b646260a5800ff90",
    "mode": "100644",
    "size": 28836
  },
  {
    "path": "product_release/TESTER_OPERATIONS.md",
    "oid": "b621fd3138d0a7f3687b21320440d54a85d6dd29",
    "mode": "100644",
    "size": 22478
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/README.md",
    "oid": "fb43f0782ece43a026b5468803f5d4db011f6ca2",
    "mode": "100644",
    "size": 3232
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/SHA256SUMS",
    "oid": "397561be488d0ba8a5d60bfbf4648988da6188fe",
    "mode": "100644",
    "size": 1350
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/manifest.json",
    "oid": "e167721969953d2ff0c4535af4b580f5ffb81b04",
    "mode": "100644",
    "size": 5459
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.14bcb70c-b6f3-4ca8-8020-59a810217ac4.readback.log",
    "oid": "8a2623b5ac22342f823675dbb51b6d990841e80e",
    "mode": "100644",
    "size": 975
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.385b988b-a182-4bd7-b6f9-b6d08ec0e0c8.user-stage.readback.log",
    "oid": "2faedceef162c3feec55185a2e05e0feb15125ea",
    "mode": "100644",
    "size": 1380
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.4233c347-c344-4f9b-870d-2afe6e4f25b3.user-stage.readback.log",
    "oid": "93bc75313c00a6ec8eb97c444fedc57020570c43",
    "mode": "100644",
    "size": 1380
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.4c411373-7659-4d72-b523-df83a888f9e3.user-stage.readback.log",
    "oid": "bf1cc7e3e8e2aeca807bc770c9d0fc8896ac3244",
    "mode": "100644",
    "size": 1380
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.6b29d535-c093-4969-a149-2018e6dafd74.readback.log",
    "oid": "48993631d27fe99141c0acc11ef6bdc0cd48e0dc",
    "mode": "100644",
    "size": 2413
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.b87fff60-dc85-4a89-a820-77bd16c3d8d1.user-stage.readback.log",
    "oid": "a7d6316f20dec432b9d23852817bb0b5cfe0f75c",
    "mode": "100644",
    "size": 1455
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.e6d6e411-6273-481d-8df4-82f62ce79b62.user-stage.readback.log",
    "oid": "96be83b9d8a66d1567d4769261ad3833fe2c0107",
    "mode": "100644",
    "size": 1380
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.human-worksheet.md",
    "oid": "26e664d96f445ca825637036de7727ffd7221b6b",
    "mode": "100644",
    "size": 1155
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.readback-verdicts.json",
    "oid": "32ccc2fcdfa07e141c3b6634ced495c269a2259e",
    "mode": "100644",
    "size": 582
  },
  {
    "path": "product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.receipt.json",
    "oid": "725ff4415595e03fceda5ccdaefd79da8aebaca6",
    "mode": "100644",
    "size": 21869
  },
  {
    "path": "product_release/evidence/retained/documentation-clause-receiving-2026-10-28.json",
    "oid": "1bad0cb5f298977921688c4a5f303eb739280f34",
    "mode": "100644",
    "size": 6894004
  },
  {
    "path": "product_release/evidence/stt/README.md",
    "oid": "659040be5d64abaf34cc5b96a817e3eb6e12a26e",
    "mode": "100644",
    "size": 4364
  }
];
const files = () => PINS.map(({path}) => ({path}));
const evidence = () => ({ repository: REPO, number: 1674, headRepository: REPO, baseRef: 'main', headSha: HEAD, baseSha: BASE, treeSha: TREE,
  complete: true, entries: PINS.map(row => ({...row, type: 'blob'})) });
const input = () => ({ repository: REPO, pullRequestNumber: 1674, baseSha: BASE, currentSha: HEAD,
  reviewedSha: HEAD, reviewStatus: 'completed', findingCount: 0, generatedAt: new Date().toISOString(),
  changedFiles: PINS.map(row => row.path), documentationEvidence: evidence() });
const pull = () => ({ number:1674, headRefOid:HEAD, baseRefOid:BASE, baseRefName:'main',
  headRefName:'pm-browser/served-release-binding-docs-20261021',
  baseRepository:{nameWithOwner:REPO}, headRepository:{nameWithOwner:REPO},
  files:{nodes:files(),pageInfo:{hasNextPage:false}}, reviews:{nodes:[{
    author:{login:'chatgpt-codex-connector'},state:'COMMENTED',commit:{oid:HEAD},body:'reviewed',
    submittedAt:'2026-10-28T17:34:11Z'}],pageInfo:{hasPreviousPage:false}},
  reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}},
  comments:{nodes:[],pageInfo:{hasPreviousPage:false}}, documentationEvidence:evidence() });
afterEach(() => vi.unstubAllGlobals());
describe('#1674 reviewed documentation/evidence scope', () => {
  it('admits the real 31 reviewed postimages without treating them as implementation', () => {
    expect(evaluateReviewQualification(input())).toMatchObject({qualified:true,
      reviewScope:'pinned_product_release_documentation_evidence',substantiveFiles:[]});
  });
  it('retains the actual pre-fix rejection when no live postimages are supplied', () => {
    expect(evaluateReviewQualification({...input(),documentationEvidence:undefined})).toMatchObject({qualified:false});
  });
  it.each([
    ['other PR', value => {value.pullRequestNumber=1675;}],
    ['other repository', value => {value.repository='elsewhere/speaksharp';}],
    ['invalid head', value => {value.currentSha='bad';}],
    ['invalid base', value => {value.baseSha='bad';}],
    ['missing path', value => {value.changedFiles.pop();}],
    ['extra runtime path', value => {value.changedFiles.push('scripts/evil.mjs');}],
    ['duplicate path', value => {value.changedFiles[1]=value.changedFiles[0];}],
    ['changed blob', value => {value.documentationEvidence.entries[0].oid='a'.repeat(40);}],
    ['missing blob', value => {delete value.documentationEvidence.entries[0].oid;}],
    ['symlink', value => {value.documentationEvidence.entries[0].mode='120000';}],
    ['executable', value => {value.documentationEvidence.entries[0].mode='100755';}],
    ['submodule', value => {value.documentationEvidence.entries[0].type='commit';value.documentationEvidence.entries[0].mode='160000';}],
    ['wrong size', value => {value.documentationEvidence.entries[0].size++;}],
    ['string size', value => {value.documentationEvidence.entries[0].size=String(value.documentationEvidence.entries[0].size);}],
    ['missing metadata', value => {value.documentationEvidence.entries.pop();}],
    ['duplicate metadata', value => {value.documentationEvidence.entries[1]={...value.documentationEvidence.entries[0]};}],
    ['truncated metadata', value => {value.documentationEvidence.complete=false;}],
    ['stale head', value => {value.documentationEvidence.headSha='a'.repeat(40);}],
    ['stale base', value => {value.documentationEvidence.baseSha='b'.repeat(40);}],
    ['malformed tree', value => {value.documentationEvidence.treeSha='bad';}],
    ['forged repository', value => {value.documentationEvidence.repository='elsewhere/speaksharp';}],
    ['forged PR', value => {value.documentationEvidence.number=1675;}],
    ['unfinished review', value => {value.reviewStatus='running';}],
    ['blocking finding', value => {value.findingCount=1;}],
    ['stale receipt', value => {value.generatedAt='2026-01-01T00:00:00Z';}],
  ])('refuses %s', (_name, mutate) => {
    const value=input();mutate(value);expect(evaluateReviewQualification(value).qualified).toBe(false);
  });
  it('carries the same verified metadata through buildReviewReceipt', () => {
    expect(buildReviewReceipt({pullRequest:pull(),expectedHeadSha:HEAD})).toMatchObject({
      qualified:true,reviewScope:'pinned_product_release_documentation_evidence'});
    const value=pull();delete value.documentationEvidence;
    expect(buildReviewReceipt({pullRequest:value,expectedHeadSha:HEAD}).qualified).toBe(false);
  });
});

function mockGithub(change = () => {}) {
  const state={tree:{sha:TREE,truncated:false,tree:PINS.map(({oid,...row})=>({...row,sha:oid,type:'blob'}))},
    commit:{sha:HEAD,tree:{sha:TREE}},final:pull(),initial:pull(),calls:[]};
  delete state.initial.documentationEvidence;delete state.final.documentationEvidence;
  change(state);
  vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
    const parsed=new URL(url);state.calls.push(parsed.pathname+parsed.search);
    if(parsed.origin!=='https://api.github.com'||options?.headers?.Authorization!=='Bearer synthetic'){
      throw Error('unexpected network');
    }
    let body;
    if(parsed.pathname==='/graphql'){
      const query=JSON.parse(options.body).query;
      body={data:{repository:{pullRequest:query.includes('documentationPostimageIdentity')?state.final:state.initial}}};
    }else if(parsed.pathname===`/repos/${REPO}/git/commits/${HEAD}`) body=state.commit;
    else if(parsed.pathname===`/repos/${REPO}/git/trees/${TREE}`) body=state.tree;
    else if(parsed.pathname===`/repos/${REPO}/activity`) body=[];
    else throw Error('unexpected API '+parsed.pathname);
    return {ok:true,status:200,json:async()=>structuredClone(body)};
  }));
  return state;
}
describe('exported live reader used by collection and merge guard',()=>{
  it('acquires immutable head commit/tree metadata and rechecks the live tuple',async()=>{
    const state=mockGithub();
    const value=await readPullRequest({repository:REPO,number:1674,token:'synthetic'});
    expect(buildReviewReceipt({pullRequest:value,expectedHeadSha:HEAD}).qualified).toBe(true);
    expect(state.calls).toContain(`/repos/${REPO}/git/commits/${HEAD}`);
    expect(state.calls).toContain(`/repos/${REPO}/git/trees/${TREE}?recursive=1`);
    expect(state.calls.filter(path=>path==='/graphql')).toHaveLength(2);
  });
  it.each([
    ['truncated tree',state=>{state.tree.truncated=true;}],
    ['wrong commit',state=>{state.commit.sha='a'.repeat(40);}],
    ['wrong tree',state=>{state.tree.sha='b'.repeat(40);}],
    ['duplicate tree path',state=>{state.tree.tree.push({...state.tree.tree[0]});}],
    ['missing postimage',state=>{state.tree.tree.pop();}],
    ['changed live head',state=>{state.final.headRefOid='a'.repeat(40);}],
    ['changed live base',state=>{state.final.baseRefOid='b'.repeat(40);}],
    ['fork identity',state=>{state.initial.headRepository.nameWithOwner='elsewhere/speaksharp';}],
  ])('refuses %s in the shared reader',async(_name,change)=>{
    mockGithub(change);
    let receipt;
    try {const value=await readPullRequest({repository:REPO,number:1674,token:'synthetic'});
      receipt=buildReviewReceipt({pullRequest:value,expectedHeadSha:HEAD});}
    catch {receipt={qualified:false};}
    expect(receipt.qualified).toBe(false);
  });
});



// #1599's independent frozen postimages; candidate files never supply these expectations.
{
const HEAD = 'c9747c6b9030045ec9303ec276f413b9c8d431bc';
const BASE = 'd2425ee700eb1f1875d84d4144b68a29302e6c0a';
const TREE = 'ad14be301f760c1b776fa1597205d16b33028f9f';
const PINS = [
  {
    "path": "local-packets/1599-model-status-control/README.md",
    "oid": "23e345dea0da592e1c6a9cd9765d8ab22a21e57b",
    "mode": "100644",
    "size": 2624
  },
  {
    "path": "local-packets/1599-model-status-control/edit.mjs",
    "oid": "9942d9759b6ed2e09183fea1dff432212f1bb523",
    "mode": "100644",
    "size": 1459
  },
  {
    "path": "local-packets/1599-model-status-control/inspect-native.py",
    "oid": "e02ed0ca701232bdfa37eacbdebcd1f93b409363",
    "mode": "100644",
    "size": 723
  },
  {
    "path": "local-packets/1599-model-status-control/native-receipts.json",
    "oid": "058fbb2cb968b85d0cf66aee9aff08977064dc93",
    "mode": "100644",
    "size": 3906
  },
  {
    "path": "local-packets/1599-model-status-control/preserve-package.py",
    "oid": "ac271ead1d1c58d30a069a4b437cd6893eaf7acf",
    "mode": "100644",
    "size": 2442
  },
  {
    "path": "local-packets/1599-model-status-control/verify-native.test.mjs",
    "oid": "f0808c29474edb983b46358ea8931037e85800aa",
    "mode": "100644",
    "size": 6570
  },
  {
    "path": "product_release/ROADMAP.md",
    "oid": "1769c07635ead0df59990bcdb6fb949e182e0838",
    "mode": "100644",
    "size": 23129
  },
  {
    "path": "product_release/work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-10-12.md",
    "oid": "0cc9545660dff6709a4d5171268bedf04982b0fb",
    "mode": "100644",
    "size": 20082
  },
  {
    "path": "product_release/work_items/financial-analysis/SpeakSharp_Updated_Financial_Model_2026-10-12.xlsx",
    "oid": "c78f60fa0383ae2461f209bdb96a0a50b2909f5e",
    "mode": "100644",
    "size": 76656
  }
];
const files = () => PINS.map(({path}) => ({path}));
const evidence = () => ({ repository: REPO, number: 1599, headRepository: REPO, baseRef: 'main', headSha: HEAD, baseSha: BASE, treeSha: TREE,
  complete: true, entries: PINS.map(row => ({...row, type: 'blob'})) });
const input = () => ({ repository: REPO, pullRequestNumber: 1599, baseSha: BASE, currentSha: HEAD,
  reviewedSha: HEAD, reviewStatus: 'completed', findingCount: 0, generatedAt: new Date().toISOString(),
  changedFiles: PINS.map(row => row.path), documentationEvidence: evidence() });
const pull = () => ({ number:1599, headRefOid:HEAD, baseRefOid:BASE, baseRefName:'main',
  headRefName:'pm-browser/served-release-binding-docs-20261021',
  baseRepository:{nameWithOwner:REPO}, headRepository:{nameWithOwner:REPO},
  files:{nodes:files(),pageInfo:{hasNextPage:false}}, reviews:{nodes:[{
    author:{login:'chatgpt-codex-connector'},state:'COMMENTED',commit:{oid:HEAD},body:'reviewed',
    submittedAt:'2026-10-28T17:34:11Z'}],pageInfo:{hasPreviousPage:false}},
  reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}},
  comments:{nodes:[],pageInfo:{hasPreviousPage:false}}, documentationEvidence:evidence() });
describe('#1599 reviewed documentation/evidence scope', () => {
  it.each(PINS.map(row => row.path))('refuses a changed postimage at %s', path => {
    const value = input();
    value.documentationEvidence.entries.find(row => row.path === path).oid = 'f'.repeat(40);
    expect(evaluateReviewQualification(value).qualified).toBe(false);
  });
  it('admits the real 9 reviewed postimages without treating them as implementation', () => {
    expect(evaluateReviewQualification(input())).toMatchObject({qualified:true,
      reviewScope:'pinned_product_release_documentation_evidence',substantiveFiles:[]});
  });
  it('retains the actual pre-fix rejection when no live postimages are supplied', () => {
    expect(evaluateReviewQualification({...input(),documentationEvidence:undefined})).toMatchObject({qualified:false});
  });
  it.each([
    ['other PR', value => {value.pullRequestNumber=1675;}],
    ['other repository', value => {value.repository='elsewhere/speaksharp';}],
    ['invalid head', value => {value.currentSha='bad';}],
    ['invalid base', value => {value.baseSha='bad';}],
    ['missing path', value => {value.changedFiles.pop();}],
    ['extra runtime path', value => {value.changedFiles.push('scripts/evil.mjs');}],
    ['duplicate path', value => {value.changedFiles[1]=value.changedFiles[0];}],
    ['changed blob', value => {value.documentationEvidence.entries[0].oid='a'.repeat(40);}],
    ['missing blob', value => {delete value.documentationEvidence.entries[0].oid;}],
    ['symlink', value => {value.documentationEvidence.entries[0].mode='120000';}],
    ['executable', value => {value.documentationEvidence.entries[0].mode='100755';}],
    ['submodule', value => {value.documentationEvidence.entries[0].type='commit';value.documentationEvidence.entries[0].mode='160000';}],
    ['wrong size', value => {value.documentationEvidence.entries[0].size++;}],
    ['string size', value => {value.documentationEvidence.entries[0].size=String(value.documentationEvidence.entries[0].size);}],
    ['missing metadata', value => {value.documentationEvidence.entries.pop();}],
    ['duplicate metadata', value => {value.documentationEvidence.entries[1]={...value.documentationEvidence.entries[0]};}],
    ['truncated metadata', value => {value.documentationEvidence.complete=false;}],
    ['stale head', value => {value.documentationEvidence.headSha='a'.repeat(40);}],
    ['stale base', value => {value.documentationEvidence.baseSha='b'.repeat(40);}],
    ['malformed tree', value => {value.documentationEvidence.treeSha='bad';}],
    ['forged repository', value => {value.documentationEvidence.repository='elsewhere/speaksharp';}],
    ['forged PR', value => {value.documentationEvidence.number=1675;}],
    ['unfinished review', value => {value.reviewStatus='running';}],
    ['blocking finding', value => {value.findingCount=1;}],
    ['stale receipt', value => {value.generatedAt='2026-01-01T00:00:00Z';}],
  ])('refuses %s', (_name, mutate) => {
    const value=input();mutate(value);expect(evaluateReviewQualification(value).qualified).toBe(false);
  });
  it('carries the same verified metadata through buildReviewReceipt', () => {
    expect(buildReviewReceipt({pullRequest:pull(),expectedHeadSha:HEAD})).toMatchObject({
      qualified:true,reviewScope:'pinned_product_release_documentation_evidence'});
    const value=pull();delete value.documentationEvidence;
    expect(buildReviewReceipt({pullRequest:value,expectedHeadSha:HEAD}).qualified).toBe(false);
  });
});

function mockGithub(change = () => {}) {
  const state={tree:{sha:TREE,truncated:false,tree:PINS.map(({oid,...row})=>({...row,sha:oid,type:'blob'}))},
    commit:{sha:HEAD,tree:{sha:TREE}},final:pull(),initial:pull(),calls:[]};
  delete state.initial.documentationEvidence;delete state.final.documentationEvidence;
  change(state);
  vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
    const parsed=new URL(url);state.calls.push(parsed.pathname+parsed.search);
    if(parsed.origin!=='https://api.github.com'||options?.headers?.Authorization!=='Bearer synthetic'){
      throw Error('unexpected network');
    }
    let body;
    if(parsed.pathname==='/graphql'){
      const query=JSON.parse(options.body).query;
      body={data:{repository:{pullRequest:query.includes('documentationPostimageIdentity')?state.final:state.initial}}};
    }else if(parsed.pathname===`/repos/${REPO}/git/commits/${HEAD}`) body=state.commit;
    else if(parsed.pathname===`/repos/${REPO}/git/trees/${TREE}`) body=state.tree;
    else if(parsed.pathname===`/repos/${REPO}/activity`) body=[];
    else throw Error('unexpected API '+parsed.pathname);
    return {ok:true,status:200,json:async()=>structuredClone(body)};
  }));
  return state;
}
describe('#1599 exported live reader used by collection and merge guard',()=>{
  it('acquires immutable head commit/tree metadata and rechecks the live tuple',async()=>{
    const state=mockGithub();
    const value=await readPullRequest({repository:REPO,number:1599,token:'synthetic'});
    expect(buildReviewReceipt({pullRequest:value,expectedHeadSha:HEAD}).qualified).toBe(true);
    expect(state.calls).toContain(`/repos/${REPO}/git/commits/${HEAD}`);
    expect(state.calls).toContain(`/repos/${REPO}/git/trees/${TREE}?recursive=1`);
    expect(state.calls.filter(path=>path==='/graphql')).toHaveLength(2);
  });
  it.each([
    ['truncated tree',state=>{state.tree.truncated=true;}],
    ['wrong commit',state=>{state.commit.sha='a'.repeat(40);}],
    ['wrong tree',state=>{state.tree.sha='b'.repeat(40);}],
    ['duplicate tree path',state=>{state.tree.tree.push({...state.tree.tree[0]});}],
    ['missing postimage',state=>{state.tree.tree.pop();}],
    ['changed live head',state=>{state.final.headRefOid='a'.repeat(40);}],
    ['changed live base',state=>{state.final.baseRefOid='b'.repeat(40);}],
    ['fork identity',state=>{state.initial.headRepository.nameWithOwner='elsewhere/speaksharp';}],
  ])('refuses %s in the shared reader',async(_name,change)=>{
    mockGithub(change);
    let receipt;
    try {const value=await readPullRequest({repository:REPO,number:1599,token:'synthetic'});
      receipt=buildReviewReceipt({pullRequest:value,expectedHeadSha:HEAD});}
    catch {receipt={qualified:false};}
    expect(receipt.qualified).toBe(false);
  });
});


}
