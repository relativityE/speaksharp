'use strict';
// Pure validation only. This module opens no sockets and does not implement a browser fault.
// A structurally valid proof is NOT proof that the R0 readback actually happened. The oracle's
// reviewed bytes and runtime independent readback receipts still need qualification there.
const crypto = require('node:crypto');
const SHA = /^[0-9a-f]{64}$/;
const isCanonicalSessionUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const payloadCaptures = new WeakMap();
const captureScopeHash=f=>sha256(JSON.stringify([f.host,f.method,f.path,f.accountSubjectSha256,f.expectedSessionSha256,f.sessionPointer,f.completionStatusPointer,f.expectedStatus,f.canonicalSessionUuidRequired===true]));
function immutableJsonCopy(value) {
  const copy=JSON.parse(JSON.stringify(value));
  const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
  return freeze(copy);
}
function capturedExpectedOperation(f) {
  const capture=payloadCaptures.get(f);
  if(f.operationIdentityMode!=='bound-session-capture-payload'||!capture||f.payloadCaptured!==true||captureScopeHash(f)!==capture.capturedScopeSha256||f.requestBodySha256!==capture.requestBodySha256||f.operationDigest!==capture.operationDigest||JSON.stringify(f.expectedRequestBody)!==JSON.stringify(capture.expectedRequestBody)) throw new Error('HARNESS_LIMITED: original bound-session payload has not been captured at the boundary');
  return immutableJsonCopy({requestBody:capture.expectedRequestBody,requestBodySha256:capture.requestBodySha256,operationDigest:capture.operationDigest,accountSubjectSha256:f.accountSubjectSha256,expectedSessionSha256:f.expectedSessionSha256});
}
function isoMs(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)) return NaN;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return NaN;
  const normalized = s.includes('.') ? s : s.replace(/Z$/, '.000Z');
  return new Date(ms).toISOString() === normalized ? ms : NaN;
}
const nonempty = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 256;

function getPointer(object, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error('invalid JSON pointer');
  let value = object;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) throw new Error('operation identity missing');
    value = value[key];
  }
  if (!nonempty(value)) throw new Error('operation identity must be a nonempty string');
  return value;
}

function operationDigest(body, pointers) {
  const values = ['account', 'take', 'completion'].map((name) => getPointer(body, pointers[name]));
  // Fixed-order, length-delimited JSON prevents delimiter ambiguity. No raw identity is logged.
  return sha256(JSON.stringify(values));
}
function sessionPayloadAuthDigest(accountSubjectSha256, sessionId, requestBodySha256) {
  if (!SHA.test(accountSubjectSha256 || '') || !SHA.test(requestBodySha256 || '') || !nonempty(sessionId)) throw new Error('session/payload/auth digest inputs invalid');
  return sha256(JSON.stringify([accountSubjectSha256, sessionId, requestBodySha256]));
}
function accountSubjectHash(headers) {
  // The decoded sub is a correlation claim only, NOT independently verified JWT authentication.
  // Server-side signature/owner enforcement and readback remain separate required evidence.
  const matches = Object.entries(headers || {}).filter(([key]) => key.toLowerCase() === 'authorization');
  if (matches.length !== 1 || typeof matches[0][1] !== 'string' || matches[0][1].length > 32768) throw new Error('one bearer token required');
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(matches[0][1]);
  if (!token) throw new Error('bearer token invalid');
  const payload = JSON.parse(Buffer.from(token[1].split('.')[1], 'base64url').toString('utf8'));
  if (!nonempty(payload.sub)) throw new Error('bearer subject missing');
  return sha256(payload.sub);
}

function validateFaultBinding(f) {
  const errors = [];
  if (!f || typeof f !== 'object') throw new Error('fault binding required');
  if (!nonempty(f.id)) errors.push('id');
  if (!['request-lost', 'response-lost'].includes(f.mode)) errors.push('mode');
  if (typeof f.host !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(f.host)) errors.push('host');
  if (f.method !== 'POST') errors.push('method must be exact POST for selected completion operation');
  // The literal path is wrapped in anchors for compatibility with the consultant's fault file.
  // Regex wildcards, alternation, query strings and percent-encoding are deliberately unsupported.
  if (typeof f.path !== 'string' || !/^\^\/[A-Za-z0-9_/-]+\$$/.test(f.path)) errors.push('exact anchored literal path');
  if(f.canonicalSessionUuidRequired!==undefined&&f.canonicalSessionUuidRequired!==true)errors.push('canonicalSessionUuidRequired cannot be disabled');
  const captureMode=f.operationIdentityMode==='bound-session-capture-payload';
  if(!captureMode)for (const name of ['operationDigest', 'requestBodySha256']) if (!SHA.test(f[name] || '')) errors.push(name);
  if(captureMode){
    const hasBody=f.requestBodySha256!=null,hasDigest=f.operationDigest!=null;
    if(hasBody!==hasDigest||(hasBody&&(!SHA.test(f.requestBodySha256)||!SHA.test(f.operationDigest))))errors.push('partial/invalid captured payload hashes');
    if(f.payloadCaptured===true&&(!hasBody||!f.expectedRequestBody||typeof f.expectedRequestBody!=='object'))errors.push('captured payload fields missing');
  }
  if(!SHA.test(f.oracleSourceSha256||''))errors.push('oracleSourceSha256');
  if (!nonempty(f.oracleSourceId)) errors.push('oracleSourceId');
  const identityMode = f.operationIdentityMode || 'three-body-pointers';
  if (identityMode === 'three-body-pointers') {
    for (const name of ['account', 'take', 'completion']) {
      const p = f.operationPointers?.[name];
      if (typeof p !== 'string' || !p.startsWith('/') || /~(?![01])/u.test(p)) errors.push('operationPointers.' + name);
    }
    if (new Set(Object.values(f.operationPointers || {})).size !== 3 || Object.keys(f.operationPointers || {}).length !== 3) errors.push('three distinct operation pointers');
  } else if (identityMode === 'session-payload-auth-sub'||identityMode === 'bound-session-capture-payload') {
    for (const name of ['sessionPointer', 'completionStatusPointer']) if (typeof f[name] !== 'string' || !f[name].startsWith('/') || /~(?![01])/u.test(f[name])) errors.push(name);
    if (f.sessionPointer === f.completionStatusPointer) errors.push('distinct session/status pointers');
    if (f.expectedStatus !== 'completed') errors.push('expectedStatus must be completed');
    if (!SHA.test(f.accountSubjectSha256 || '')) errors.push('accountSubjectSha256');
    if(identityMode==='bound-session-capture-payload'&&!SHA.test(f.expectedSessionSha256||''))errors.push('expectedSessionSha256');
  } else {
    errors.push('unsupported operationIdentityMode');
  }
  if (errors.length) throw new Error('fault binding invalid: ' + errors.join(', '));
  return f;
}

function matchFaultRequest(f, request) {
  validateFaultBinding(f);
  if (request.host !== f.host || request.method !== f.method || request.pathname !== f.path.slice(1, -1)) return { matched: false, reason: 'operation-route-mismatch' };
  if (!Buffer.isBuffer(request.bodyBuffer)) return { matched: false, reason: 'body-bytes-required' };
  const requestBodySha256=sha256(request.bodyBuffer),captureMode=f.operationIdentityMode==='bound-session-capture-payload',previous=payloadCaptures.get(f);
  const boundBodySha=previous?.requestBodySha256||f.requestBodySha256;
  if ((!captureMode||boundBodySha) && requestBodySha256 !== boundBodySha) return { matched: false, reason: 'request-body-mismatch' };
  let digest;
  let captured=null;
  try {
    const body = JSON.parse(request.bodyBuffer.toString('utf8'));
    if (f.operationIdentityMode === 'session-payload-auth-sub'||captureMode) {
      const subjectHash = accountSubjectHash(request.headers);
      if (subjectHash !== f.accountSubjectSha256) return { matched: false, reason: 'account-subject-mismatch' };
      if (getPointer(body, f.completionStatusPointer) !== f.expectedStatus) return { matched: false, reason: 'completion-status-mismatch' };
      const session=getPointer(body,f.sessionPointer);
      if(f.canonicalSessionUuidRequired&&!isCanonicalSessionUuid(session))return{matched:false,reason:'noncanonical-session-identity'};
      if(captureMode&&sha256(session)!==f.expectedSessionSha256)return{matched:false,reason:'bound-session-mismatch'};
      digest = sessionPayloadAuthDigest(subjectHash, session, requestBodySha256);
      if(captureMode&&!previous&&!f.requestBodySha256&&!f.operationDigest){
        captured=Object.freeze({requestBodySha256,operationDigest:digest,expectedRequestBody:immutableJsonCopy(body),payloadCaptured:true,capturedScopeSha256:captureScopeHash(f)});
        payloadCaptures.set(f,captured);
      }
    } else {
      digest = operationDigest(body, f.operationPointers);
    }
  }
  catch { return { matched: false, reason: 'operation-identity-unreadable' }; }
  if (digest !== (previous?.operationDigest||captured?.operationDigest||f.operationDigest)) return { matched: false, reason: 'operation-identity-mismatch' };
  if(captureMode&&!previous&&!captured)return{matched:false,reason:'payload-capture-not-established'};
  return { matched: true, reason: null, operationDigest: digest, requestBodySha256, ...(captured?{captured}:{}) };
}

function verifyDurableReadback(f, response, proof) {
  validateFaultBinding(f);
  const reject = (reason) => ({ verified: false, suppressResponse: false, result: 'HARNESS_LIMITED', reason });
  if(f.operationIdentityMode==='bound-session-capture-payload'){try{capturedExpectedOperation(f);}catch{return reject('payload-not-captured');}}
  if (f.mode !== 'response-lost') return reject('not-response-lost');
  if (!Number.isInteger(response?.status) || response.status < 200 || response.status > 299) return reject('upstream-non-success');
  if (response.complete !== true) return reject('upstream-response-incomplete');
  if (response.operationDigest !== f.operationDigest) return reject('upstream-operation-mismatch');
  if (!nonempty(response.requestReceiptId) || !nonempty(response.sourceId) || !Number.isFinite(isoMs(response.responseCompletedAt))) return reject('upstream-receipt-missing');
  if (!proof || proof.kind !== 'independent-readback') return reject('independent-readback-missing');
  if (proof.oracleSourceSha256 !== f.oracleSourceSha256 || proof.sourceId !== f.oracleSourceId) return reject('oracle-source-unbound');
  if (proof.sourceId === response.sourceId || !nonempty(proof.readbackRequestReceiptId) || proof.readbackRequestReceiptId === response.requestReceiptId) return reject('readback-not-independent');
  if (proof.operationDigest !== f.operationDigest) return reject('readback-operation-mismatch');
  if (proof.durableSaved !== true || proof.savedRowCount !== 1) return reject('durable-exactly-one-not-established');
  if (proof.readbackStatus !== 200 || proof.complete !== true) return reject('readback-unsuccessful-or-incomplete');
  const start = isoMs(proof.readbackStartedAt), observed = isoMs(proof.observedAt), completed = isoMs(response.responseCompletedAt);
  if (!Number.isFinite(start) || !Number.isFinite(observed) || start < completed || observed < start) return reject('readback-order-unproven');
  return { verified: true, suppressResponse: true, result: 'CONTRACT_VALID', reason: null,
    operationDigest: f.operationDigest, oracleSourceSha256: f.oracleSourceSha256,
    saveRequestReceiptId: response.requestReceiptId, readbackRequestReceiptId: proof.readbackRequestReceiptId,
    note: 'Structural contract only; independent runtime evidence and non-retryable browser fault still require R0 qualification.' };
}

module.exports = { isCanonicalSessionUuid, validateFaultBinding, matchFaultRequest, verifyDurableReadback, operationDigest, sessionPayloadAuthDigest, capturedExpectedOperation, immutableJsonCopy };
