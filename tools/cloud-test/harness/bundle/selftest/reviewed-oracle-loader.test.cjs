'use strict';
// Pure fixture modules + fake counted transport; no sockets/browser/credentials/product access.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { loadReviewedOracle, normalizeReadbackBinding, readbackRequestHash, isReviewedOracle } = require('../harness/reviewed-oracle-loader.cjs');
const { operationDigest, verifyDurableReadback, matchFaultRequest } = require('../harness/fault-contract.cjs');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const normalModule = `exports.readback = async ({request,operationDigest}) => { const response=await request(); const rows=JSON.parse(response.bodyText); return {operationDigest,durableSaved:rows.length===1,savedRowCount:rows.length}; };`;
function fixture(t, code = normalModule) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-oracle-unit-')); fs.chmodSync(root, 0o700);
  const oracleFile = path.join(root, 'oracle.cjs'), manifestFile = path.join(root, 'reviewed.json');
  fs.writeFileSync(oracleFile, code, { mode: 0o600 });
  const manifest = { version: 1, scope: 'trusted-reviewed-node-not-sandbox', reviewer: 'Offline fixture only; not actual approval', reviewedAt: '2026-10-27T11:00:00.000Z', steps: [{ path: 'oracle.cjs', sha256: sha(code), dependencies: [] }] };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
  t.after(() => { delete require.cache[oracleFile]; fs.rmSync(root, { recursive: true, force: true }); });
  const readbackBinding = { host: 'fixture.example', method: 'GET', pathname: '/rest/v1/sessions', search: '?id=eq.fixture-take&select=id' };
  const options = { manifestFile, expectedManifestSha256: sha(fs.readFileSync(manifestFile)), stepRoot: root, oracleFile, sourceId: 'fixture-readback-oracle', readbackBinding };
  const body = { account: 'fixture-account', take: 'fixture-take', completion: 'fixture-completion' };
  const operationPointers = { account: '/account', take: '/take', completion: '/completion' };
  const binding = { id: 'fixture-fault', mode: 'response-lost', host: readbackBinding.host, method: 'POST', path: '^/rest/v1/rpc/complete_session_v2$', operationPointers,
    operationDigest: operationDigest(body, operationPointers), requestBodySha256: sha(JSON.stringify(body)), oracleSourceSha256: sha(code), oracleSourceId: options.sourceId,
    readbackRequestSha256: readbackRequestHash(readbackBinding) };
  const ac = new AbortController(); let calls = 0;
  const invocation = { binding, responseCompletedAt: '2026-10-27T11:00:00.000Z', requestReceiptId: 'fixture-save-receipt', signal: ac.signal,
    request: async ({ url }) => {
      calls++; assert.equal(url, 'https://fixture.example/rest/v1/sessions?id=eq.fixture-take&select=id');
      return { status: 200, complete: true, body: Buffer.from('[{"id":"fixture-take"}]'),
        receipt: { requestReceiptId: 'fixture-readback-receipt', status: 200, complete: true, startedAt: '2026-10-27T11:00:00.001Z', completedAt: '2026-10-27T11:00:00.002Z', capsReserved: true, method: 'GET', urlSha256: sha(url), redirectsFollowed: 0 } };
    } };
  return { options, binding, invocation, ac, calls: () => calls };
}
test('reviewed oracle has one bound counted GET; metadata comes from guard', async t => {
  const f = fixture(t), oracle = loadReviewedOracle(f.options), proof = await oracle.readback(f.invocation);
  assert.equal(f.calls(), 1); assert.equal(proof.savedRowCount, 1); assert.equal(proof.sourceId, f.options.sourceId);
  assert.equal(proof.oracleSourceSha256, f.binding.oracleSourceSha256); assert.equal(proof.readbackRequestReceiptId, 'fixture-readback-receipt');
  assert.equal(verifyDurableReadback(f.binding, { status: 200, complete: true, responseCompletedAt: f.invocation.responseCompletedAt, requestReceiptId: f.invocation.requestReceiptId, sourceId: 'fixture-save-transport', operationDigest: f.binding.operationDigest }, proof).verified, true);
});
test('only loader-created objects carry the private reviewed-oracle brand', t => {
  const f = fixture(t), oracle = loadReviewedOracle(f.options);
  assert.equal(isReviewedOracle(oracle), true); assert.equal(isReviewedOracle({ ...oracle }), false);
  assert.equal(isReviewedOracle({ sha256: f.binding.oracleSourceSha256, readback: async () => ({}) }), false);
  assert.equal(isReviewedOracle(null), false);
});
test('loader refuses changed reviewed oracle bytes', t => {
  const f = fixture(t); fs.appendFileSync(f.options.oracleFile, '\n// tamper'); assert.throws(() => loadReviewedOracle(f.options), /bytes changed/);
});
test('loader refuses old cached code rather than assuming matching disk bytes', t => {
  const f = fixture(t); loadReviewedOracle(f.options); assert.throws(() => loadReviewedOracle(f.options), /already cached/);
});
test('module must export a readback function', t => { const f = fixture(t, 'exports.other = true;'); assert.throws(() => loadReviewedOracle(f.options), /export a readback function/); });
test('only GET JSON readback supported', () => assert.throws(() => normalizeReadbackBinding({ host: 'fixture.example', method: 'HEAD', pathname: '/rows', search: '' }), /GET only/));
test('readback binding rejects network client/header/URL overrides', () => assert.throws(() => normalizeReadbackBinding({ host: 'fixture.example', method: 'GET', pathname: '/rows', search: '', headers: { authorization: 'not-a-token' } }), /cannot supply/));
for (const [name, change] of [ ['wrong source', { oracleSourceId: 'another-oracle' }], ['wrong source bytes', { oracleSourceSha256: sha('other') }], ['wrong backend', { host: 'different.example' }], ['wrong query hash', { readbackRequestSha256: sha('different') }] ]) test('oracle refuses ' + name, async t => {
  const f = fixture(t), oracle = loadReviewedOracle(f.options); await assert.rejects(oracle.readback({ ...f.invocation, binding: { ...f.binding, ...change } })); assert.equal(f.calls(), 0);
});
test('module cannot call its capability with another target', async t => {
  const f = fixture(t, `exports.readback=async({request,operationDigest})=>{await request({url:'https://other.example/'});return{operationDigest,durableSaved:true,savedRowCount:1};};`);
  await assert.rejects(loadReviewedOracle(f.options).readback(f.invocation), /no overrides/); assert.equal(f.calls(), 0);
});
test('module cannot skip the counted readback', async t => {
  const f = fixture(t, `exports.readback=async({operationDigest})=>({operationDigest,durableSaved:true,savedRowCount:1});`);
  await assert.rejects(loadReviewedOracle(f.options).readback(f.invocation), /exactly one/); assert.equal(f.calls(), 0);
});
test('a caught second-readback failure still invalidates proof', async t => {
  const f = fixture(t, `exports.readback=async({request,operationDigest})=>{await request();try{await request();}catch{}return{operationDigest,durableSaved:true,savedRowCount:1};};`);
  await assert.rejects(loadReviewedOracle(f.options).readback(f.invocation), /exactly one/); assert.equal(f.calls(), 1);
});
test('oracle cannot inject receipt/source/status fields', async t => {
  const f = fixture(t, `exports.readback=async({request,operationDigest})=>{await request();return{operationDigest,durableSaved:true,savedRowCount:1,readbackStatus:200};};`);
  await assert.rejects(loadReviewedOracle(f.options).readback(f.invocation), /cannot supply proof metadata/);
});
for (const [name, changed] of [ ['no reservation', { capsReserved: false }], ['redirect followed', { redirectsFollowed: 1 }], ['wrong URL hash', { urlSha256: sha('other') }], ['wrong method', { method: 'POST' }], ['same save receipt', { requestReceiptId: 'fixture-save-receipt' }], ['early readback', { startedAt: '2026-10-27T10:59:59.999Z' }] ]) test('guard receipt refuses ' + name, async t => {
  const f = fixture(t), original = f.invocation.request;
  f.invocation.request = async spec => { const r = await original(spec); return { ...r, receipt: { ...r.receipt, ...changed } }; };
  await assert.rejects(loadReviewedOracle(f.options).readback(f.invocation));
});
test('real error status cannot be replaced by oracle success claim', async t => {
  const f = fixture(t), original = f.invocation.request;
  f.invocation.request = async spec => { const r = await original(spec); return { ...r, status: 503, receipt: { ...r.receipt, status: 503 } }; };
  const proof = await loadReviewedOracle(f.options).readback(f.invocation); assert.equal(proof.readbackStatus, 503);
  const r = verifyDurableReadback(f.binding, { status: 200, complete: true, responseCompletedAt: f.invocation.responseCompletedAt, requestReceiptId: f.invocation.requestReceiptId, sourceId: 'fixture-save', operationDigest: f.binding.operationDigest }, proof);
  assert.equal(r.suppressResponse, false);
});
test('aborted signal prevents any counted request', async t => {
  const f = fixture(t); f.ac.abort(); await assert.rejects(loadReviewedOracle(f.options).readback(f.invocation), /cancelled/); assert.equal(f.calls(), 0);
});
test('cancellation rejects a stalled fake guard request', async t => {
  const f = fixture(t); f.invocation.request = async () => new Promise(() => {});
  const pending = loadReviewedOracle(f.options).readback(f.invocation); setImmediate(() => f.ac.abort()); await assert.rejects(pending, /cancelled/);
});
function captureInvocation(f){const body={p_session_id:'fixture-take',p_status:'completed',p_metrics:{score:7}};const bodyBuffer=Buffer.from(JSON.stringify(body));const sub='fixture-account';const token=Buffer.from('{"alg":"fixture"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub})).toString('base64url')+'.Zml4dHVyZQ';const b={...f.binding,operationIdentityMode:'bound-session-capture-payload',accountSubjectSha256:sha(sub),expectedSessionSha256:sha(body.p_session_id),sessionPointer:'/p_session_id',completionStatusPointer:'/p_status',expectedStatus:'completed'};delete b.operationPointers;delete b.requestBodySha256;delete b.operationDigest;return{binding:b,request:{host:b.host,method:'POST',pathname:'/rest/v1/rpc/complete_session_v2',bodyBuffer,headers:{authorization:'Bearer '+token}}};}
test('oracle receives immutable defensive expected request payload for exact-row comparisons, never bearer headers',async t=>{const f=fixture(t,`'use strict';exports.readback=async({request,operationDigest,expectedOperation})=>{if(!Object.isFrozen(expectedOperation)||!Object.isFrozen(expectedOperation.requestBody)||!Object.isFrozen(expectedOperation.requestBody.p_metrics))throw Error('not frozen');if('headers'in expectedOperation||'authorization'in expectedOperation)throw Error('credential passed');try{expectedOperation.requestBody.p_metrics.score=99;}catch{}const r=await request(),rows=JSON.parse(r.bodyText);return{operationDigest,durableSaved:rows[0].id===expectedOperation.requestBody.p_session_id&&expectedOperation.requestBody.p_metrics.score===7,savedRowCount:rows.length};};`);const c=captureInvocation(f);Object.assign(c.binding,matchFaultRequest(c.binding,c.request).captured);const result=await loadReviewedOracle(f.options).readback({...f.invocation,binding:c.binding});assert.equal(result.durableSaved,true);assert.equal(c.binding.expectedRequestBody.p_metrics.score,7);});
test('oracle rejects capture mode before actual bound payload observation',async t=>{const f=fixture(t),c=captureInvocation(f);await assert.rejects(loadReviewedOracle(f.options).readback({...f.invocation,binding:c.binding}),/not been captured/);assert.equal(f.calls(),0);});
test('oracle rejects hashes reconstructed without in-memory boundary capture',async t=>{const f=fixture(t),c=captureInvocation(f);Object.assign(c.binding,matchFaultRequest(c.binding,c.request).captured);await assert.rejects(loadReviewedOracle(f.options).readback({...f.invocation,binding:{...c.binding}}),/not been captured/);assert.equal(f.calls(),0);});
