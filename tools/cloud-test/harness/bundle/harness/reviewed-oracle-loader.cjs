'use strict';
// Loads only independently hash-bound, trusted-reviewed Node oracle code. NOT a Node/OS sandbox:
// its review must rule out native fetch/http/net, subprocesses and undeclared dependencies.
// The oracle receives only a no-argument, one-use guarded readback capability. All authoritative
// receipt/source/status/time fields are produced outside the oracle from the counted guard call.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyReviewedStep } = require('./reviewed-step.cjs');
const { validateFaultBinding, capturedExpectedOperation, immutableJsonCopy, isCanonicalSessionUuid } = require('./fault-contract.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const nonempty = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 256;
const loadedOracles = new WeakSet();
const sessionFactories = new WeakSet();
function isReviewedSessionOracleFactory(value) { return !!value && typeof value==='object' && sessionFactories.has(value); }
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function sessionReadbackBinding(contract,{host,ownerId,sessionId,sourceSha}) {
  if(!contract||contract.version!==1||contract.kind!=='own-session-v1'||contract.pathname!=='/rest/v1/sessions'||contract.host!==host||contract.sourceSha!==sourceSha||!UUID.test(ownerId||'')||!isCanonicalSessionUuid(sessionId)||!Array.isArray(contract.columns)||!contract.columns.length||contract.columns.some(c=>!/^[_a-z]+$/.test(c))||new Set(contract.columns).size!==contract.columns.length) throw new Error('source-reviewed exact own-session contract required');
  const query=new URLSearchParams();query.set('select',contract.columns.join(','));query.set('user_id','eq.'+ownerId);query.set('id','eq.'+sessionId);query.set('limit','2');
  return normalizeReadbackBinding({host,method:'GET',pathname:contract.pathname,search:'?'+query.toString()});
}
function isReviewedOracle(value) { return !!value && typeof value === 'object' && loadedOracles.has(value); }

function normalizeReadbackBinding(binding) {
  if (!binding || typeof binding !== 'object') throw new Error('reviewed readback binding required');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(binding.host || '')) throw new Error('readback host invalid');
  if (binding.method !== 'GET') throw new Error('readback is GET only (row JSON required)');
  if (typeof binding.pathname !== 'string' || !/^\/[A-Za-z0-9_/-]+$/.test(binding.pathname)) throw new Error('readback exact literal pathname required');
  if (binding.search !== '' && (typeof binding.search !== 'string' || !binding.search.startsWith('?') || /[\r\n#]/.test(binding.search))) throw new Error('readback exact query required (empty string allowed)');
  const permitted = ['host', 'method', 'pathname', 'search'];
  if (Object.keys(binding).some(k => !permitted.includes(k))) throw new Error('readback binding cannot supply headers, clients or options');
  const normalized = { host: binding.host, method: binding.method, pathname: binding.pathname, search: binding.search };
  const url = new URL('https://' + normalized.host + normalized.pathname + normalized.search);
  if (url.hostname !== normalized.host || url.pathname !== normalized.pathname || url.search !== normalized.search || url.port || url.username || url.password || url.hash) throw new Error('non-canonical readback URL');
  return Object.freeze(normalized);
}
function readbackRequestHash(binding) { return hash(JSON.stringify(normalizeReadbackBinding(binding))); }
function time(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)) return NaN;
  const ms = Date.parse(s); return Number.isFinite(ms) && new Date(ms).toISOString() === s ? ms : NaN;
}
function abortError() { return new Error('HARNESS_LIMITED: readback cancelled'); }
async function abortable(fn, signal) {
  if (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') throw new Error('guard cancellation signal required');
  if (signal.aborted) throw abortError();
  let onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject(abortError()); signal.addEventListener('abort', onAbort, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(fn), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
function validateOracleData(data, expectedDigest) {
  if (!data || typeof data !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(data))) throw new Error('oracle must return one plain JSON object');
  const allowed = ['operationDigest', 'durableSaved', 'savedRowCount'];
  const keys = Object.keys(data);
  if (keys.length !== allowed.length || keys.some(k => !allowed.includes(k))) throw new Error('oracle return cannot supply proof metadata');
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(data, key), 'value')) throw new Error('oracle return accessors refused');
  if (data.operationDigest !== expectedDigest || typeof data.durableSaved !== 'boolean' || !Number.isSafeInteger(data.savedRowCount) || data.savedRowCount < 0) throw new Error('oracle data/operation invalid');
  return { operationDigest: data.operationDigest, durableSaved: data.durableSaved, savedRowCount: data.savedRowCount };
}

function loadReviewedOracle(options) {
  const { manifestFile, expectedManifestSha256, stepRoot, oracleFile, sourceId } = options;
  if (!nonempty(sourceId)) throw new Error('oracle sourceId required');
  if (!!options.dynamicSessionBinding === !!options.readbackBinding) throw new Error('exactly one fixed or reviewed dynamic readback binding required');
  const verified = verifyReviewedStep({ manifestFile, expectedManifestSha256, stepRoot, stepFile: oracleFile });
  const absolute = path.resolve(oracleFile);
  if (path.extname(absolute) !== '.cjs') throw new Error('reviewed oracle must be an explicit .cjs module');
  // Refuse an older cached entry/dependency rather than claiming current on-disk bytes were loaded.
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const entry = manifest.steps.find(item => item.path === verified.stepPath);
  for (const file of [entry, ...entry.dependencies]) {
    const local = path.resolve(stepRoot, file.path);
    if (require.cache[local]) throw new Error('reviewed oracle/dependency already cached; use a fresh supervised process');
  }
  verifyReviewedStep({ manifestFile, expectedManifestSha256, stepRoot, stepFile: oracleFile });
  const module = require(absolute);
  const descriptor = module && Object.getOwnPropertyDescriptor(module, 'readback');
  if (!descriptor || typeof descriptor.value !== 'function') throw new Error('reviewed oracle must export a readback function');
  const oracle = descriptor.value;
  function makeBound(requestBinding, sessionContext=null) {
  const bindingHash=readbackRequestHash(requestBinding);
  const loaded = Object.freeze({ sha256: verified.stepSha256, sourceId, readbackRequestSha256: bindingHash,
    scope: 'trusted-reviewed-node-not-sandbox',
    async readback({ binding, responseCompletedAt, requestReceiptId, signal, request: guardedReadback }) {
      validateFaultBinding(binding);
      if (binding.mode !== 'response-lost' || binding.oracleSourceSha256 !== verified.stepSha256 || binding.oracleSourceId !== sourceId) throw new Error('oracle source is not bound to this fault');
      if (binding.host !== requestBinding.host || binding.readbackRequestSha256 !== bindingHash) throw new Error('readback route/query is not bound to this operation');
      if (typeof guardedReadback !== 'function') throw new Error('counted guarded readback capability required');
      if (!nonempty(requestReceiptId) || !Number.isFinite(time(responseCompletedAt))) throw new Error('upstream completion receipt required');
      const captured=binding.operationIdentityMode==='bound-session-capture-payload'?capturedExpectedOperation(binding):immutableJsonCopy({requestBody:binding.expectedRequestBody||null,requestBodySha256:binding.requestBodySha256,operationDigest:binding.operationDigest,accountSubjectSha256:binding.accountSubjectSha256||null,expectedSessionSha256:binding.expectedSessionSha256||null});
      if(sessionContext && (binding.operationIdentityMode!=='bound-session-capture-payload'||captured.accountSubjectSha256!==hash(sessionContext.ownerId)||captured.expectedSessionSha256!==hash(sessionContext.sessionId))) throw new Error('dynamic readback owner/session was retargeted');
      const expectedOperation=sessionContext?immutableJsonCopy({...captured,beforeRow:sessionContext.beforeRow}):captured;
      let calls = 0, tracked = null, pending = null;
      const request = (...args) => {
        calls++;
        if (calls !== 1 || args.length) return Promise.reject(new Error('oracle may call bound request() exactly once with no overrides'));
        pending = abortable(async () => {
          const url = 'https://' + requestBinding.host + requestBinding.pathname + requestBinding.search;
          const response = await guardedReadback(Object.freeze({ url }));
          const receipt = response?.receipt;
          if (!receipt || !nonempty(receipt.requestReceiptId) || receipt.requestReceiptId === requestReceiptId || !Number.isInteger(receipt.status) || receipt.status < 100 || receipt.status > 599 || typeof receipt.complete !== 'boolean' || !Buffer.isBuffer(response.body) || response.body.length > 2097152) throw new Error('guard readback receipt malformed or body too large');
          if (receipt.status !== response.status || receipt.complete !== response.complete || receipt.capsReserved !== true || receipt.method !== 'GET' || receipt.redirectsFollowed !== 0 || receipt.urlSha256 !== hash(url)) throw new Error('guard readback route/cap/status evidence invalid');
          const started = time(receipt.startedAt), ended = time(receipt.completedAt);
          if (!Number.isFinite(started) || !Number.isFinite(ended) || started < time(responseCompletedAt) || ended < started) throw new Error('guard readback ordering invalid');
          tracked = Object.freeze({ requestReceiptId: receipt.requestReceiptId, status: receipt.status, complete: receipt.complete, startedAt: receipt.startedAt, completedAt: receipt.completedAt });
          return Object.freeze({ status: receipt.status, bodyText: response.body.toString('utf8') });
        }, signal);
        return pending;
      };
      let data;
      try { data = await abortable(() => oracle(Object.freeze({ request, operationDigest: binding.operationDigest, expectedOperation })), signal); }
      catch (error) {
        // Do not return to the supervisor leaving a counted GET unobserved. Its guard deadline/
        // cancellation remains authoritative; this module never initiates an alternate request.
        if (pending) await pending.catch(() => {});
        throw error;
      }
      if (calls !== 1 || !pending) throw new Error('oracle must perform exactly one counted readback');
      await pending;
      if (calls !== 1 || !tracked) throw new Error('one completed counted readback required');
      const value = validateOracleData(data, binding.operationDigest);
      return Object.freeze({ kind: 'independent-readback', oracleSourceSha256: verified.stepSha256, sourceId,
        readbackRequestReceiptId: tracked.requestReceiptId, ...value, readbackStatus: tracked.status, complete: tracked.complete,
        readbackStartedAt: tracked.startedAt, observedAt: tracked.completedAt });
    } });
  loadedOracles.add(loaded);
  return loaded;
  }
  if(options.readbackBinding)return makeBound(normalizeReadbackBinding(options.readbackBinding));
  const d=options.dynamicSessionBinding;
  if(!d||Object.keys(d).sort().join(',')!=='host,ownerId,sourceSha'||!UUID.test(d.ownerId||'')||!/^[0-9a-f]{40}$/.test(d.sourceSha||''))throw new Error('dynamic readback source/owner configuration invalid');
  const contractDescriptor=Object.getOwnPropertyDescriptor(module,'readbackContract');
  if(!contractDescriptor||!Object.hasOwn(contractDescriptor,'value'))throw new Error('reviewed oracle must export source-derived readbackContract');
  const contract=immutableJsonCopy(contractDescriptor.value), configured=immutableJsonCopy(d);
  sessionReadbackBinding(contract,{...configured,sessionId:configured.ownerId});
  const baselineValidator=Object.getOwnPropertyDescriptor(module,'validateBaseline');
  if(!baselineValidator||typeof baselineValidator.value!=='function')throw new Error('reviewed oracle must validate the pre-Stop baseline');
  let bound=false;
  const factory=Object.freeze({sha256:verified.stepSha256,sourceId,scope:'trusted-reviewed-node-not-sandbox',sourceSha:configured.sourceSha,host:configured.host,accountSubjectSha256:hash(configured.ownerId),
    bindSession(input) {
      if(bound)throw new Error('reviewed session readback already bound; cannot retarget');
      if(!input||Object.keys(input).sort().join(',')!=='baselineRow,ownerId,sessionId,sourceSha'||input.ownerId!==configured.ownerId||input.sourceSha!==configured.sourceSha)throw new Error('dynamic readback owner/source mismatch or override');
      const requestBinding=sessionReadbackBinding(contract,{...configured,sessionId:input.sessionId});
      const beforeRow=immutableJsonCopy(input.baselineRow);baselineValidator.value(beforeRow,input.ownerId,input.sessionId);
      const loaded=makeBound(requestBinding,immutableJsonCopy({ownerId:input.ownerId,sessionId:input.sessionId,beforeRow}));
      bound=true;return loaded;
    }
  });
  sessionFactories.add(factory);return factory;
}

module.exports = { loadReviewedOracle, normalizeReadbackBinding, readbackRequestHash, isReviewedOracle, isReviewedSessionOracleFactory, sessionReadbackBinding };
