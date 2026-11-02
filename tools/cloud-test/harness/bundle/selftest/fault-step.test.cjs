'use strict';
// Offline structural/unit tests. No browser, socket, account, credential or production access.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateFaultBinding, matchFaultRequest, verifyDurableReadback, operationDigest, sessionPayloadAuthDigest, capturedExpectedOperation } = require('../harness/fault-contract.cjs');
const { verifyReviewedStep } = require('../harness/reviewed-step.cjs');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const bodyBuffer = Buffer.from(JSON.stringify({ account: 'fixture-account', take: 'fixture-take', completion: 'fixture-completion' }));
const pointers = { account: '/account', take: '/take', completion: '/completion' };
const binding = {
  id: 'fixture-response-lost', mode: 'response-lost', host: 'fixture.example', method: 'POST', path: '^/rest/v1/rpc/complete_session_v2$',
  operationPointers: pointers, operationDigest: operationDigest(JSON.parse(bodyBuffer), pointers), requestBodySha256: sha(bodyBuffer),
  oracleSourceSha256: sha('reviewed fixture oracle'), oracleSourceId: 'fixture-independent-readback'
};
const request = { host: binding.host, method: binding.method, pathname: '/rest/v1/rpc/complete_session_v2', bodyBuffer };
const response = { status: 200, complete: true, responseCompletedAt: '2026-10-27T11:00:00.000Z', requestReceiptId: 'fixture-save-receipt', sourceId: 'fixture-save-transport', operationDigest: binding.operationDigest };
const proof = { kind: 'independent-readback', oracleSourceSha256: binding.oracleSourceSha256, sourceId: binding.oracleSourceId,
  readbackRequestReceiptId: 'fixture-readback-receipt', operationDigest: binding.operationDigest, durableSaved: true, savedRowCount: 1,
  readbackStatus: 200, complete: true, readbackStartedAt: '2026-10-27T11:00:00.001Z', observedAt: '2026-10-27T11:00:00.002Z' };

test('exact route, body and three-part operation binding matches', () => {
  assert.equal(validateFaultBinding(binding), binding);
  assert.equal(matchFaultRequest(binding, request).matched, true);
});
for (const [name, changed] of [
  ['host', { host: 'other.example' }], ['method', { method: 'GET' }], ['path', { pathname: '/rest/v1/rpc/complete_session_v2/other' }],
  ['body bytes', { bodyBuffer: Buffer.from(bodyBuffer.toString() + ' ') }], ['missing bytes', { bodyBuffer: undefined }]
]) test('fault refuses different ' + name, () => assert.equal(matchFaultRequest(binding, { ...request, ...changed }).matched, false));
test('fault refuses a different operation even when body hash is rebound', () => {
  const changedBody = Buffer.from(JSON.stringify({ account: 'fixture-account', take: 'different-take', completion: 'fixture-completion' }));
  assert.equal(matchFaultRequest({ ...binding, requestBodySha256: sha(changedBody) }, { ...request, bodyBuffer: changedBody }).reason, 'operation-identity-mismatch');
});
test('fault rejects wildcard and unanchored endpoint matching', () => {
  for (const bad of ['^/rest/v1/rpc/.*$', '/rest/v1/rpc/complete_session_v2', '^/rest/(one|two)$']) assert.throws(() => validateFaultBinding({ ...binding, path: bad }));
});
test('operation requires all three distinct JSON pointers', () => {
  assert.throws(() => validateFaultBinding({ ...binding, operationPointers: { account: '/account', take: '/take', completion: '/take' } }));
  assert.throws(() => operationDigest({ account: 'a', take: 't' }, pointers));
});
test('valid structural readback permits suppression but is not live proof', () => {
  const result = verifyDurableReadback(binding, response, proof);
  assert.equal(result.verified, true); assert.equal(result.suppressResponse, true); assert.equal(result.result, 'CONTRACT_VALID');
  assert.match(result.note, /runtime evidence/);
});
for (const status of [0, 301, 400, 401, 409, 500, 503]) test('HTTP ' + status + ' cannot establish response-lost success', () => {
  const result = verifyDurableReadback(binding, { ...response, status }, proof);
  assert.equal(result.suppressResponse, false); assert.equal(result.reason, 'upstream-non-success');
});
test('incomplete upstream response cannot be suppressed', () => assert.equal(verifyDurableReadback(binding, { ...response, complete: false }, proof).verified, false));
for (const [name, changed] of [
  ['missing', null], ['wrong operation', { ...proof, operationDigest: sha('other') }],
  ['wrong oracle bytes', { ...proof, oracleSourceSha256: sha('other') }], ['wrong oracle source', { ...proof, sourceId: 'other-oracle' }],
  ['same request receipt', { ...proof, readbackRequestReceiptId: response.requestReceiptId }],
  ['not durable', { ...proof, durableSaved: false }], ['zero rows', { ...proof, savedRowCount: 0 }], ['duplicate rows', { ...proof, savedRowCount: 2 }],
  ['error readback', { ...proof, readbackStatus: 500 }], ['incomplete readback', { ...proof, complete: false }],
  ['early readback', { ...proof, readbackStartedAt: '2026-10-27T10:59:59.999Z' }],
  ['backwards observation', { ...proof, observedAt: '2026-10-27T11:00:00.000Z' }], ['missing timestamp', { ...proof, observedAt: undefined }]
]) test('readback refuses ' + name, () => {
  const result = verifyDurableReadback(binding, response, changed);
  assert.equal(result.suppressResponse, false); assert.equal(result.result, 'HARNESS_LIMITED');
});
test('readback must name a distinct evidence source', () => assert.equal(verifyDurableReadback(binding, { ...response, sourceId: proof.sourceId }, proof).reason, 'readback-not-independent'));
test('missing upstream source cannot establish independence', () => assert.equal(verifyDurableReadback(binding, { ...response, sourceId: undefined }, proof).reason, 'upstream-receipt-missing'));
test('calendar-invalid timestamp cannot prove readback ordering', () => {
  const malformedResponse = { ...response, responseCompletedAt: '2026-02-31T11:00:00.000Z' };
  assert.equal(verifyDurableReadback(binding, malformedResponse, proof).reason, 'upstream-receipt-missing');
});
test('request-lost cannot use a response-lost proof', () => assert.equal(verifyDurableReadback({ ...binding, mode: 'request-lost' }, response, proof).reason, 'not-response-lost'));

function reviewedFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-step-unit-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'step.cjs'), '// inert fixture, never evaluated\n', { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'dep.cjs'), '// inert dependency, never evaluated\n', { mode: 0o600 });
  const manifest = { version: 1, scope: 'trusted-reviewed-node-not-sandbox', reviewer: 'Offline fixture reviewer (not a real review)', reviewedAt: '2026-10-27T11:00:00.000Z',
    steps: [{ path: 'step.cjs', sha256: sha(fs.readFileSync(path.join(root, 'step.cjs'))), dependencies: [{ path: 'dep.cjs', sha256: sha(fs.readFileSync(path.join(root, 'dep.cjs'))) }] }] };
  const manifestFile = path.join(root, 'reviewed.json');
  const save = () => { fs.writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 }); return sha(fs.readFileSync(manifestFile)); };
  const options = { manifestFile, expectedManifestSha256: save(), stepRoot: root, stepFile: path.join(root, 'step.cjs') };
  return { root, manifest, options, save };
}
test('reviewed-step verifier verifies declared bytes without executing', (t) => {
  const f = reviewedFixture(t), result = verifyReviewedStep(f.options);
  assert.equal(result.filesVerified, 2); assert.equal(result.execution, 'NOT_PERFORMED'); assert.equal(result.networkIsolation, 'NOT_PROVIDED');
});
test('unlisted entry is refused', (t) => {
  const f = reviewedFixture(t); fs.writeFileSync(path.join(f.root, 'other.cjs'), 'throw new Error("must never execute")');
  assert.throws(() => verifyReviewedStep({ ...f.options, stepFile: path.join(f.root, 'other.cjs') }), /unlisted/);
});
test('changed step bytes are refused', (t) => {
  const f = reviewedFixture(t); fs.appendFileSync(f.options.stepFile, '// changed\n');
  assert.throws(() => verifyReviewedStep(f.options), /bytes changed/);
});
test('changed dependency bytes are refused', (t) => {
  const f = reviewedFixture(t); fs.appendFileSync(path.join(f.root, 'dep.cjs'), '// changed\n');
  assert.throws(() => verifyReviewedStep(f.options), /bytes changed/);
});
test('changed manifest is refused even if it declares new file hash', (t) => {
  const f = reviewedFixture(t); f.manifest.steps[0].sha256 = sha('changed'); f.save();
  assert.throws(() => verifyReviewedStep(f.options), /manifest bytes changed/);
});
test('manifest expected digest must be supplied independently', (t) => {
  const f = reviewedFixture(t); assert.throws(() => verifyReviewedStep({ ...f.options, expectedManifestSha256: undefined }), /independently bound/);
});
test('symlinked entry is refused', (t) => {
  const f = reviewedFixture(t); fs.renameSync(f.options.stepFile, path.join(f.root, 'real.cjs')); fs.symlinkSync('real.cjs', f.options.stepFile);
  assert.throws(() => verifyReviewedStep(f.options), /symlink/);
});
test('outside-root step is refused before reading its bytes', (t) => {
  const f = reviewedFixture(t); assert.throws(() => verifyReviewedStep({ ...f.options, stepFile: path.join(f.root, '..', 'outside.cjs') }), /outside/);
});
test('manifest cannot claim network sandbox', (t) => {
  const f = reviewedFixture(t); f.manifest.scope = 'node-network-sandbox'; f.options.expectedManifestSha256 = f.save();
  assert.throws(() => verifyReviewedStep(f.options), /disclaim Node sandbox/);
});
test('unnamed reviewer is refused', (t) => {
  const f = reviewedFixture(t); f.manifest.reviewer = ''; f.options.expectedManifestSha256 = f.save();
  assert.throws(() => verifyReviewedStep(f.options), /reviewer/);
});
test('dependency parent traversal is refused', (t) => {
  const f = reviewedFixture(t); f.manifest.steps[0].dependencies[0].path = '../dep.cjs'; f.options.expectedManifestSha256 = f.save();
  assert.throws(() => verifyReviewedStep(f.options), /non-canonical/);
});
test('symlinked dependency is refused', (t) => {
  const f = reviewedFixture(t); fs.renameSync(path.join(f.root, 'dep.cjs'), path.join(f.root, 'real-dep.cjs')); fs.symlinkSync('real-dep.cjs', path.join(f.root, 'dep.cjs'));
  assert.throws(() => verifyReviewedStep(f.options), /symlink/);
});
test('duplicate entry cannot become an ambiguous reviewed step', (t) => {
  const f = reviewedFixture(t); f.manifest.steps.push(f.manifest.steps[0]); f.options.expectedManifestSha256 = f.save();
  assert.throws(() => verifyReviewedStep(f.options), /ambiguous/);
});

// This schema is a historical observation only; selecting it requires exact R0 source binding.
function sessionFixture() {
  const body = { p_session_id: 'fixture-session', p_status: 'completed', p_immutable_payload: 'fixture-only' };
  const bytes = Buffer.from(JSON.stringify(body));
  const token = subject => Buffer.from('{"alg":"fixture-not-signed"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: subject })).toString('base64url') + '.Zml4dHVyZQ';
  const f = { ...binding, operationIdentityMode: 'session-payload-auth-sub', sessionPointer: '/p_session_id', completionStatusPointer: '/p_status', expectedStatus: 'completed',
    accountSubjectSha256: sha('fixture-subject'), requestBodySha256: sha(bytes), operationDigest: sessionPayloadAuthDigest(sha('fixture-subject'), body.p_session_id, sha(bytes)) };
  delete f.operationPointers;
  return { f, body, token, request: { ...request, bodyBuffer: bytes, headers: { authorization: 'Bearer ' + token('fixture-subject') } } };
}
test('session-payload-auth-sub binds complete payload, session and hashed subject', () => {
  const f = sessionFixture(); assert.equal(matchFaultRequest(f.f, f.request).matched, true);
});
test('session binding refuses missing bearer token', () => {
  const f = sessionFixture(); assert.equal(matchFaultRequest(f.f, { ...f.request, headers: {} }).matched, false);
});
test('session binding refuses another account subject', () => {
  const f = sessionFixture(); assert.equal(matchFaultRequest(f.f, { ...f.request, headers: { authorization: 'Bearer ' + f.token('other-subject') } }).reason, 'account-subject-mismatch');
});
test('session binding refuses malformed JWT payload', () => {
  const f = sessionFixture(); assert.equal(matchFaultRequest(f.f, { ...f.request, headers: { authorization: 'Bearer abc.def.ghi' } }).matched, false);
});
test('session binding refuses ambiguous authorization headers', () => {
  const f = sessionFixture(); assert.equal(matchFaultRequest(f.f, { ...f.request, headers: { ...f.request.headers, Authorization: f.request.headers.authorization } }).matched, false);
});
test('session binding refuses changed immutable payload', () => {
  const f = sessionFixture(), changed = Buffer.from(JSON.stringify({ ...f.body, p_immutable_payload: 'different' }));
  assert.equal(matchFaultRequest(f.f, { ...f.request, bodyBuffer: changed }).reason, 'request-body-mismatch');
});
test('session binding refuses changed session even with a rebound body hash', () => {
  const f = sessionFixture(), changed = Buffer.from(JSON.stringify({ ...f.body, p_session_id: 'other-session' }));
  assert.equal(matchFaultRequest({ ...f.f, requestBodySha256: sha(changed) }, { ...f.request, bodyBuffer: changed }).reason, 'operation-identity-mismatch');
});
test('session binding refuses noncompleted status despite rebound body hash and digest', () => {
  const f = sessionFixture(), changed = Buffer.from(JSON.stringify({ ...f.body, p_status: 'abandoned' }));
  const rebound = { ...f.f, requestBodySha256: sha(changed), operationDigest: sessionPayloadAuthDigest(f.f.accountSubjectSha256, f.body.p_session_id, sha(changed)) };
  assert.equal(matchFaultRequest(rebound, { ...f.request, bodyBuffer: changed }).reason, 'completion-status-mismatch');
});
test('unknown identity mode and unbound expected completion status are refused', () => {
  const f = sessionFixture(); assert.throws(() => validateFaultBinding({ ...f.f, operationIdentityMode: 'invented' }));
  assert.throws(() => validateFaultBinding({ ...f.f, expectedStatus: 'abandoned' }));
});
function captureFixture(){const x=sessionFixture();x.f.operationIdentityMode='bound-session-capture-payload';x.f.expectedSessionSha256=sha(x.body.p_session_id);delete x.f.operationDigest;delete x.f.requestBodySha256;return x;}
test('pre-Stop capture binding requires known account and the exact newly observed session hash',()=>{const x=captureFixture();assert.equal(validateFaultBinding(x.f),x.f);assert.throws(()=>validateFaultBinding({...x.f,expectedSessionSha256:undefined}));assert.throws(()=>validateFaultBinding({...x.f,accountSubjectSha256:undefined}));});
test('exact bound account/session/completed request captures otherwise unknown payload in memory',()=>{const x=captureFixture(),match=matchFaultRequest(x.f,x.request);assert.equal(match.matched,true);assert.equal(match.captured.requestBodySha256,sha(x.request.bodyBuffer));assert.deepEqual(match.captured.expectedRequestBody,x.body);assert.equal(x.f.operationDigest,undefined);Object.assign(x.f,match.captured);const expected=capturedExpectedOperation(x.f);assert.equal(expected.requestBody.p_session_id,x.body.p_session_id);assert(Object.isFrozen(expected));assert(Object.isFrozen(expected.requestBody));assert.equal('headers'in expected,false);});
test('wrong account never captures a payload',()=>{const x=captureFixture();const m=matchFaultRequest(x.f,{...x.request,headers:{authorization:'Bearer '+x.token('wrong-subject')}});assert.equal(m.matched,false);assert.equal(m.captured,undefined);assert.throws(()=>capturedExpectedOperation(x.f));});
test('wrong session never captures a payload',()=>{const x=captureFixture(),bodyBuffer=Buffer.from(JSON.stringify({...x.body,p_session_id:'other'}));const m=matchFaultRequest(x.f,{...x.request,bodyBuffer});assert.equal(m.reason,'bound-session-mismatch');assert.equal(m.captured,undefined);});
test('noncompleted status never captures a payload',()=>{const x=captureFixture(),bodyBuffer=Buffer.from(JSON.stringify({...x.body,p_status:'abandoned'}));const m=matchFaultRequest(x.f,{...x.request,bodyBuffer});assert.equal(m.reason,'completion-status-mismatch');assert.equal(m.captured,undefined);});
test('later body cannot overwrite first capture even before caller assigns returned capture',()=>{const x=captureFixture(),first=matchFaultRequest(x.f,x.request),bodyBuffer=Buffer.from(JSON.stringify({...x.body,p_immutable_payload:'changed'}));const second=matchFaultRequest(x.f,{...x.request,bodyBuffer});assert.equal(first.matched,true);assert.equal(second.matched,false);assert.equal(second.captured,undefined);Object.assign(x.f,first.captured);assert.equal(capturedExpectedOperation(x.f).requestBody.p_immutable_payload,'fixture-only');});
test('missing or reconstructed capture cannot authorize response suppression',()=>{const x=captureFixture();assert.equal(verifyDurableReadback(x.f,response,proof).reason,'payload-not-captured');Object.assign(x.f,matchFaultRequest(x.f,x.request).captured);const forged={...x.f};assert.equal(verifyDurableReadback(forged,{...response,operationDigest:x.f.operationDigest},{...proof,operationDigest:x.f.operationDigest}).reason,'payload-not-captured');assert.throws(()=>capturedExpectedOperation(forged));});
test('captured binding scope mutation is refused before readback',()=>{const x=captureFixture();Object.assign(x.f,matchFaultRequest(x.f,x.request).captured);x.f.accountSubjectSha256=sha('changed');assert.throws(()=>capturedExpectedOperation(x.f));});
test('captured exact request can qualify only with same-operation durable readback proof',()=>{const x=captureFixture();Object.assign(x.f,matchFaultRequest(x.f,x.request).captured);const r=verifyDurableReadback(x.f,{...response,operationDigest:x.f.operationDigest},{...proof,operationDigest:x.f.operationDigest});assert.equal(r.verified,true);assert.equal(r.suppressResponse,true);});
