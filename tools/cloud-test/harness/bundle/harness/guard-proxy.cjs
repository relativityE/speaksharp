'use strict';
// guard-proxy.cjs: the single egress boundary for the guarded browser (Playwright and Lighthouse).
//
// The browser is launched with this proxy as its only route out (launch.cjs flags: proxy for every
// host including loopback, host resolver mapped to NOTFOUND, QUIC off). Every HTTPS CONNECT is
// refused unless the host is allowlisted; allowed tunnels are terminated here with an ephemeral
// per-run certificate that only this browser profile trusts (by SPKI), so every request inside them
// (navigations, every redirect hop, subresources, fetch/XHR, preflights, workers, beacons) is checked
// against an explicit host + method + path rule before anything is sent upstream. Default deny.
//
// Redirects are NOT followed here: a 3xx goes back to the browser unchanged, and the browser's next
// hop is a new request that comes back through this boundary and is checked again.
// WebSocket upgrades and plain-HTTP proxying are always denied.
//
// Caps are reserved and written to the ledger BEFORE a request is forwarded. A reservation is never
// refunded, so in-flight, timed-out, cancelled and ambiguous requests all count. Concurrency is
// bounded; waiting beyond queueWaitMs is a denial. Per-request deadline, campaign deadline and
// close() cancellation abort in-flight upstream work and record the outcome.
//
// One-shot faults (request-lost / response-lost) for the reviewed save-recovery cases are applied
// here, at the same boundary, so they are counted and correlated in the same log.
const http = require('http');
const tls = require('tls');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { assertSecurityApproval } = require('./approval-gate.cjs');
const {validateDownloadFault,selectDownloadFault,canInterruptDownload}=require('./download-fault.cjs');
const {CompletionAttempts}=require('./completion-attempts.cjs');
const {FeedbackFault,FIXTURE_SOURCE_SHA:FEEDBACK_FIXTURE_SOURCE,syntheticRejection,HOST:FEEDBACK_HOST,PATH:FEEDBACK_PATH,SOURCE_SHA:FEEDBACK_SOURCE,MODES:FEEDBACK_MODES}=require('./feedback-fault.cjs');
const { isReviewedOracle, isReviewedSessionOracleFactory } = require('./reviewed-oracle-loader.cjs');
const { validateFaultBinding, matchFaultRequest, verifyDurableReadback, capturedExpectedOperation } = require('./fault-contract.cjs');

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function validatePolicy(p) {
  const errs=[],owns=(o,keys)=>keys.every(k=>Object.hasOwn(o,k));
  if(!plain(p)||!owns(p,['version','sourceSha','hosts','caps','maxInFlight','queueWaitMs','requestTimeoutMs','deadlineAt','upstream']))throw new Error('policy invalid: own plain-object policy fields required');
  if(p.version!==1)errs.push('version must be 1');
  if(!/^[0-9a-f]{40}$/.test(p.sourceSha||''))errs.push('exact reviewed sourceSha required');
  if(Object.hasOwn(p,'testOnly')&&typeof p.testOnly!=='boolean')errs.push('testOnly must be a boolean');
  if(!plain(p.hosts)||!Object.keys(p.hosts).length)errs.push('own host dictionary required');
  if(!plain(p.caps)||!Object.keys(p.caps).length)errs.push('own cap dictionary required');
  for(const [h,cfg]of Object.entries(plain(p.hosts)?p.hosts:{})){
    if(!/^[a-z0-9.-]+$/.test(h)||h.length>253||['constructor','prototype','__proto__'].includes(h))errs.push('bad or reserved host');
    if(!plain(cfg)||!owns(cfg,['port','rules'])){errs.push('own plain host configuration required');continue;}
    if(cfg.port!==443)errs.push(h+': only port443 supported');
    if(!Array.isArray(cfg.rules)||!cfg.rules.length){errs.push(h+': rules required');continue;}
    for(const r of cfg.rules){
      if(!plain(r)||!owns(r,['id','cap','path','methods','reviewedSourceSha'])){errs.push('own plain rule fields required');continue;}
      if(r.review===true||r.reviewedSourceSha!==p.sourceSha)errs.push('rule review not bound');
      if(typeof r.id!=='string'||!r.id||!safeKey(r.cap)||!Object.hasOwn(p.caps||{},r.cap))errs.push('rule id/cap invalid or unbound');
      if(!Array.isArray(r.methods)||!r.methods.length||r.methods.some(m=>!METHODS.has(m)))errs.push('rule methods invalid');
      if(typeof r.path!=='string'||r.path.length>2048||!r.path.startsWith('^')||!r.path.endsWith('$'))errs.push('rule path must be bounded anchored regex');
      else try{new RegExp(r.path);}catch{errs.push('bad path regex');}
    }
  }
  for(const k of ['total','navigations'])if(!Object.hasOwn(p.caps||{},k)||!Number.isSafeInteger(p.caps[k])||p.caps[k]<0)errs.push('required cap invalid');
  for(const [k,v]of Object.entries(plain(p.caps)?p.caps:{}))if(!safeKey(k)||!Number.isSafeInteger(v)||v<0)errs.push('cap key/value invalid');
  for(const k of ['maxInFlight','queueWaitMs','requestTimeoutMs'])if(!Number.isSafeInteger(p[k])||p[k]<=0)errs.push(k+' must be positive');
  if(typeof p.deadlineAt!=='string'||!Number.isFinite(Date.parse(p.deadlineAt)))errs.push('deadlineAt must be ISO time');
  if(!plain(p.upstream)||!Object.hasOwn(p.upstream,'mode')||!['env-proxy','direct','override'].includes(p.upstream.mode))errs.push('own upstream mode required');
  if(p.testOnly!==true&&(p.upstream?.mode!=='env-proxy'||p.upstream?.allowDirectWhenNoProxyEnv===true||p.upstream?.caFile))errs.push('production requires existing env-proxy with normal TLS and no direct fallback/custom trust');
  if(p.upstream?.mode==='override'&&p.testOnly!==true)errs.push('upstream override is test-only');
  if(errs.length)throw new Error('policy invalid: '+errs.join('; '));return p;
}

// ---------- integrity-bound cumulative ledger (pre-send fsync reservations) ----------
const {Ledger,plain,safeKey}=require('./campaign-ledger.cjs');

// Keep route matching in one production-owned function so offline controls can
// exercise the exact decision used by onRequest without opening a socket.
function matchPolicyRule(policy,host,method,pathname) {
  const rules=policy?.hosts?.[host]?.rules;
  if(!Array.isArray(rules))return null;
  return rules.find(r=>r.methods.includes(method)&&new RegExp(r.path).test(pathname))||null;
}

// ---------- ephemeral TLS identity: one key, one self-signed cert per allowed host ----------
function makeTlsIdentity(hosts, dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyFile = path.join(dir, 'leaf.key');
  fs.writeFileSync(keyFile, keyPem, { mode: 0o600 });
  const spki = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const ctx = Object.create(null);
  for (const h of hosts) {
    const certFile = path.join(dir, h + '.crt');
    execFileSync('openssl', ['req', '-x509', '-new', '-key', keyFile, '-subj', '/CN=' + h, '-addext', 'subjectAltName=DNS:' + h, '-days', '2', '-out', certFile], { stdio: ['ignore', 'ignore', 'pipe'],timeout:10000,maxBuffer:65536 });
    ctx[h] = tls.createSecureContext({ key: keyPem, cert: fs.readFileSync(certFile) });
  }
  return { spki, ctx };
}

function noProxy(host) {
  const list = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.some((e) => e === host || (e.startsWith('.') && host.endsWith(e)) || (e.startsWith('*.') && host.endsWith(e.slice(1))));
}

// Upstream TLS socket: through the environment's HTTPS proxy (CONNECT) unless direct/override.
function upstreamSocket(policy, host, signal) {
  return new Promise((resolve, reject) => {
    const up = policy.upstream;
    const tlsOpts = { servername: host, ALPNProtocols: ['http/1.1'] };
    if (up.caFile) {
      if (!policy.testOnly) return reject(new Error('upstream.caFile is test-only'));
      tlsOpts.ca = fs.readFileSync(up.caFile);
    }
    if (up.mode === 'override') {
      const [h, p] = (up.override[host] || '').split(':');
      if (!h) return reject(new Error('no test override for ' + host));
      const s = tls.connect({ host: h, port: Number(p), ...tlsOpts });
      s.once('secureConnect', () => resolve(s)); s.once('error', reject);
      signal.addEventListener('abort', () => s.destroy(new Error('aborted')), { once: true });
      return;
    }
    const proxyUrl = up.mode === 'env-proxy' && !noProxy(host) ? (process.env.HTTPS_PROXY || process.env.https_proxy) : null;
    if (up.mode === 'env-proxy' && !proxyUrl && !up.allowDirectWhenNoProxyEnv) return reject(new Error('HTTPS_PROXY is not set'));
    if (!proxyUrl) {
      const s = tls.connect({ host, port: 443, ...tlsOpts });
      s.once('secureConnect', () => resolve(s)); s.once('error', reject);
      signal.addEventListener('abort', () => s.destroy(new Error('aborted')), { once: true });
      return;
    }
    const pu = new URL(proxyUrl);
    const req = http.request({ host: pu.hostname, port: pu.port || 80, method: 'CONNECT', path: host + ':443', headers: { host: host + ':443' } });
    signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.once('connect', (res, sock) => {
      if (res.statusCode !== 200) { sock.destroy(); return reject(new Error('upstream proxy CONNECT ' + res.statusCode)); }
      const s = tls.connect({ socket: sock, ...tlsOpts });
      s.once('secureConnect', () => resolve(s)); s.once('error', reject);
      signal.addEventListener('abort', () => s.destroy(new Error('aborted')), { once: true });
    });
    req.once('error', reject);
    req.end();
  });
}

class Guard {
  constructor(policy, opts) {
    this.policy = validatePolicy(policy);
    this.opts = opts;
    this.runDir = opts.runDir;
    fs.mkdirSync(this.runDir, { recursive: true, mode: 0o700 });
    if(this.policy.testOnly!==true&&!opts.expectedLedgerIdentity)throw new Error('admitted campaign ledger identity required');
    if(this.policy.testOnly!==true&&typeof opts.reserveTake!=='function')throw new Error('admitted per-case take reservation required');
    this.ledger = new Ledger(opts.ledgerFile, policy.caps,{allowCreate:this.policy.testOnly===true,expectedIdentity:opts.expectedLedgerIdentity});
    if(opts.caseRequestAllowance!==undefined){try{this.ledger.setCaseAllowance(opts.caseRequestAllowance);}catch(e){this.ledger.release();throw e;}}
    try{this.logFd = fs.openSync(opts.logFile, 'a', 0o600);}catch(e){this.ledger.release();throw new Error('guard log unavailable');}
    this.seq = 0; this.inFlight = new Map(); this.waiters = []; this.sockets = new Set(); this.active = 0;
    this.closing = false; this.faults = []; this.downloadFaults=[];this.feedbackFaults=[];
    this.c = { attempted: 0, forwarded: 0, completed: 0, denied: {}, connectAllowed: 0, connectRefused: 0, upgradesDenied: 0, plainHttpDenied: 0, inFlightMax: 0, outcomes: {}, redirectsSeen: 0 };
    this.deadline = Date.parse(policy.deadlineAt);
  }
  // EventEmitter does not await callbacks. Every owned event route goes through this boundary.
  guardCallback(fn,context='guard-event') {
    return (...args)=>{try{const p=fn(...args);if(p&&typeof p.then==='function')return p.catch(()=>this.fatal('guard-async-failure',context));return p;}catch{this.fatal('guard-callback-failure',context);}};
  }
  watch(emitter,event,fn) {emitter.on(event,this.guardCallback(fn,'event-'+event));return emitter;}
  fatal(code='guard-failure',context='guard') {
    if(this.fatalState)return this.fatalState;
    const allowed=new Set(['guard-failure','guard-async-failure','guard-callback-failure','guard-server-error','guard-ledger-integrity','guard-action-budget-integrity','guard-log-unavailable']);
    this.fatalState=Object.freeze({status:'HARNESS_FATAL',code:allowed.has(code)?code:'guard-failure',context:/^[a-z-]{1,48}$/.test(context)?context:'guard'});
    // Never log exception text, headers, bodies, account identifiers or credentials.
    try{this.log({kind:'fatal',...this.fatalState});}catch{}
    this.cancelAll('harness-fatal');
    try{const p=this.opts?.onFatal?.(this.fatalState);if(p&&typeof p.catch==='function')p.catch(()=>{});}catch{}
    // Own-resource cleanup is idempotent and bounded, including a failed/unstarted listener.
    Promise.resolve().then(()=>this.close('harness-fatal')).catch(()=>{});
    return this.fatalState;
  }
  reserveTakeForRequest(host,method,pathname) {
    if(host!==FEEDBACK_HOST||method!=='POST'||pathname!=='/rest/v1/rpc/create_session_and_update_usage')return false;
    if(typeof this.opts.reserveTake!=='function'){if(this.policy.testOnly===true)return false;throw new Error('guard action budget unavailable');}
    this.opts.reserveTake();return true;
  }
  log(ev) {
    ev.t = new Date().toISOString(); ev.seq = ++this.seq;
    try{fs.writeSync(this.logFd, JSON.stringify(ev) + '\n');}catch{this.fatal?.('guard-log-unavailable','journal-write');throw new Error('guard log unavailable');}
    return ev.seq;
  }
  durableLog(ev) {const seq=this.log(ev);try{fs.fsyncSync(this.logFd);}catch{this.fatal('guard-log-unavailable','journal-fsync');throw new Error('guard log unavailable');}return seq;}
  pathRef(p) { return this.policy.logPaths ? p : 'sha256:' + crypto.createHash('sha256').update(p).digest('hex').slice(0, 16); }
  // First per-case allowance refusal: tell the supervisor once so it stops the case promptly and cleans up (distinct interruption, not a product outcome).
  noteAllowance(over){if(over!=='case-allowance'||this.allowanceSignalled)return;this.allowanceSignalled=true;try{this.log({kind:'allowance-exhausted'});}catch{/* log failure must not mask the stop */}try{this.opts?.onAllowanceExhausted?.();}catch{/* supervisor callback failure is surfaced by the cleanup check */}}
  deny(res, reason, ev) {
    this.c.denied[reason] = (this.c.denied[reason] || 0) + 1;
    this.log({ ...ev, decision: 'denied', reason });
    if (res && !res.headersSent) { res.writeHead(403, { 'x-ss-harness-deny': reason, 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('ss-harness denied: ' + reason + '\n'); }
    else if (res) res.destroy();
  }
  armDownloadFault(f) {
    const bound=validateDownloadFault(f,this.policy);if(bound.mode==='offline-mid-download'&&typeof this.offlineControl!=='function')throw new Error('HARNESS_LIMITED: guarded browser offline capability not bound');this.downloadFaults.push(bound);
    if(bound.mode==='offline-mid-download'&&this.browserPrefixObserver)this.browserPrefixObserver.arm(bound);
    this.log({kind:'download-fault-armed',faultId:bound.id,mode:bound.mode,host:bound.host,path:this.pathRef(bound.pathname),afterBytes:bound.afterBytes||0});
    return bound.id;
  }
  async resumeDownloadNetwork(id) {
    const f=this.downloadFaults.find(x=>x.id===id&&x.mode==='offline-mid-download');
    if(!f||!f.browserOfflineApplied||typeof this.offlineControl!=='function')throw new Error('HARNESS_LIMITED: no exercised browser-offline download to restore');
    await this.offlineControl(false);f.networkRestored=true;this.log({kind:'download-network-restored',faultId:id});return true;
  }
  feedbackFaultConfiguration() {
    const fixtureOnly=this.policy.testOnly===true&&this.policy.sourceSha===FEEDBACK_FIXTURE_SOURCE&&this.policy.upstream?.mode==='override'&&/^127\.0\.0\.1:[0-9]+$/.test(this.policy.upstream.override?.['a.test']||'');
    const host=fixtureOnly?'a.test':FEEDBACK_HOST,sourceSha=fixtureOnly?FEEDBACK_FIXTURE_SOURCE:FEEDBACK_SOURCE;
    const rules=this.policy.hosts?.[host]?.rules||[];
    if(this.policy.sourceSha!==sourceSha||!rules.some(r=>r.methods.includes('POST')&&new RegExp(r.path).test(FEEDBACK_PATH)))throw new Error('HARNESS_LIMITED: reviewed feedback source/POST policy not bound');
    return Object.freeze({sourceSha,host,modes:[...FEEDBACK_MODES],fixtureOnly,deliveryProof:'plain-insert-201-explicit-replay-v1'});
  }
  armFeedbackObservation(binding) {
    const config=this.feedbackFaultConfiguration();
    if(binding.mode!=='observe-once'||binding.host!==config.host||binding.sourceSha!==config.sourceSha||this.feedbackFaults.length!==3||this.feedbackFaults.some(f=>f.binding.mode==='observe-once'||!f.summary().exactExpectedAttempts))throw new Error('HARNESS_LIMITED: final exact feedback observation requires all three fault controls complete');
    const observation=new FeedbackFault(binding,{fixtureOnly:config.fixtureOnly});this.feedbackFaults.push(observation);this.durableLog({kind:'feedback-final-observation-armed',id:binding.id,accountSubjectSha256:binding.accountSubjectSha256,expectedSessionSha256:binding.expectedSessionSha256,descriptionSha256:binding.descriptionSha256});return binding.id;
  }
  armFeedbackFault(binding) {
    const config=this.feedbackFaultConfiguration();
    if(binding.host!==config.host||binding.sourceSha!==config.sourceSha)throw new Error('HARNESS_LIMITED: feedback fixture/production scope mismatch');
    if(!FEEDBACK_MODES.includes(binding.mode)||this.feedbackFaults.length>=3||this.feedbackFaults.some(f=>f.binding.mode===binding.mode||!f.summary().exactExpectedAttempts))throw new Error('HARNESS_LIMITED: prior feedback control incomplete or mode repeated');
    const fault=new FeedbackFault(binding,{fixtureOnly:config.fixtureOnly});this.feedbackFaults.push(fault);this.durableLog({kind:'feedback-fault-armed',id:binding.id,mode:binding.mode,accountSubjectSha256:binding.accountSubjectSha256,expectedSessionSha256:binding.expectedSessionSha256,descriptionSha256:binding.descriptionSha256});return binding.id;
  }
  feedbackFaultSummary(id){const fault=this.feedbackFaults.find(f=>f.binding.id===id);if(!fault)throw new Error('HARNESS_LIMITED: feedback fault unbound');return fault.summary();}
  markFeedbackRetry(id){const fault=this.feedbackFaults.find(f=>f.binding.id===id);if(!fault)throw new Error('HARNESS_LIMITED: feedback fault unbound');fault.authorizeRetry();this.durableLog({kind:'feedback-explicit-retry-window',id});return true;}
  feedbackExpectedOperation(id){const fault=this.feedbackFaults.find(f=>f.binding.id===id);if(!fault)throw new Error('HARNESS_LIMITED: feedback fault unbound');return fault.expectedOperation();}
  compareFeedbackRows(id,rows){const fault=this.feedbackFaults.find(f=>f.binding.id===id);if(!fault)throw new Error('HARNESS_LIMITED: feedback fault unbound');return fault.compareRows(rows,true);}
  saveReadbackConfiguration() {
    const oracle=this.opts.readbackOracle;
    if(!isReviewedSessionOracleFactory(oracle)||this.saveReadbackInstalled)throw new Error('HARNESS_LIMITED: reviewed dynamic save oracle not available before Start');
    return Object.freeze({sourceSha:oracle.sourceSha,host:oracle.host,accountSubjectSha256:oracle.accountSubjectSha256});
  }
  bindSaveReadback(input) {
    const oracle=this.opts.readbackOracle;
    if(!isReviewedSessionOracleFactory(oracle)||this.saveReadbackInstalled||this.faults.length)throw new Error('HARNESS_LIMITED: save readback must be installed once before arming');
    const bound=oracle.bindSession(input);
    if(!isReviewedOracle(bound))throw new Error('HARNESS_LIMITED: unreviewed session oracle');
    this.opts.readbackOracle=bound;this.saveReadbackInstalled=true;
    return Object.freeze({sha256:bound.sha256,sourceId:bound.sourceId,readbackRequestSha256:bound.readbackRequestSha256});
  }
  markCompletionRetry(id) {
    if(!this.completionObserver||this.completionFaultId!==id)throw new Error('HARNESS_LIMITED: completion observer not bound');
    this.completionObserver.authorizeRetry();this.durableLog({kind:'completion-explicit-retry-window',faultId:id});return true;
  }
  completionAttemptSummary(id) {
    if(!this.completionObserver||this.completionFaultId!==id)throw new Error('HARNESS_LIMITED: completion observer not bound');
    return this.completionObserver.summary();
  }
  capturedSaveOperation(id) {
    const fault=this.faults.find(f=>f.id===id);
    if(!fault||!fault.selected||!fault.fired)throw new Error('HARNESS_LIMITED: save fault has not fired on a captured operation');
    return capturedExpectedOperation(fault);
  }
  armFault(f) {
    validateFaultBinding(f);
    if ((f.mode === 'response-lost' || f.operationIdentityMode === 'bound-session-capture-payload') && (!isReviewedOracle(this.opts.readbackOracle) || this.opts.readbackOracle.readbackRequestSha256 !== f.readbackRequestSha256 || this.opts.readbackOracle.sha256 !== f.oracleSourceSha256 || this.opts.readbackOracle.sourceId !== f.oracleSourceId || typeof this.opts.readbackOracle.readback !== 'function')) throw new Error('HARNESS_LIMITED: independently reviewed durable readback oracle is not bound');
    const id = 'fault-' + (this.faults.length + 1);
    if(f.operationIdentityMode==='bound-session-capture-payload'){if(this.completionObserver)throw new Error('HARNESS_LIMITED: completion observation already bound');this.completionObserver=new CompletionAttempts(f);this.completionFaultId=id;}
    this.faults.push({ ...f, ...(f.operationIdentityMode==='bound-session-capture-payload'?{canonicalSessionUuidRequired:true}:{}), id, fired: false, selected: false });
    this.log({ kind: 'fault-armed', faultId: id, mode: f.mode, host: f.host, method: f.method, operationDigest: f.operationDigest });
    return id;
  }
  matchFault(host, method, pathname, bodyBuffer, headers) {
    for (const f of this.faults) {
      if (f.selected) continue;
      const matched = matchFaultRequest(f, { host, method, pathname, bodyBuffer, headers });
      if (!matched.matched) continue;
      // Preserve the actual armed object's identity: the contract WeakMap binds one capture to it.
      if (matched.captured) Object.assign(f, matched.captured);
      f.selected = true;
      this.durableLog({kind:'fault-operation-selected',faultId:f.id,operationDigest:f.operationDigest,requestBodySha256:f.requestBodySha256,capturedScopeSha256:f.capturedScopeSha256||null});
      return f;
    }
    return undefined;
  }
  // Slots are counted synchronously at grant time (this.active), so concurrent arrivals cannot
  // all pass the check before any of them is registered.
  async slot() {
    if (this.active < this.policy.maxInFlight) { this.active++; return true; }
    return new Promise((resolve) => {
      const w = { resolve, timer: setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); resolve(false); }, this.policy.queueWaitMs) };
      this.waiters.push(w);
    });
  }
  releaseSlot() {
    this.active--;
    while (this.waiters.length && this.active < this.policy.maxInFlight) { const w = this.waiters.shift(); clearTimeout(w.timer); this.active++; w.resolve(true); }
  }

  async start() {
    if(this.opts.signal?.aborted)throw new Error('HARNESS_LIMITED: guard startup aborted');
    assertSecurityApproval(this.opts, this.policy); // gate even direct reviewed Guard construction
    const hosts = Object.keys(this.policy.hosts);
    const id = makeTlsIdentity(hosts, path.join(this.runDir, 'tls'));
    this.spki = id.spki;
    this.inner = http.createServer(this.guardCallback((req, res) => this.onRequest(req, res),'request'));
    this.watch(this.inner,'upgrade', (req, sock) => {
      this.c.upgradesDenied++;
      this.log({ kind: 'upgrade', host: sock.ssHost, method: req.method, path: this.pathRef(new URL(req.url, 'https://x').pathname), decision: 'denied', reason: 'websocket' });
      sock.end('HTTP/1.1 403 Forbidden\r\nx-ss-harness-deny: websocket\r\ncontent-length: 0\r\n\r\n');
    });
    this.watch(this.inner,'clientError', (e, sock) => sock.destroy());
    this.server = http.createServer(this.guardCallback((req, res) => {
      this.c.plainHttpDenied++;
      this.deny(res, 'plain-http', { kind: 'request', host: safeHost(req.url), method: req.method });
    },'plain-http'));
    this.watch(this.server,'connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    this.watch(this.server,'connect', (req, sock) => {
      const m = /^([a-z0-9.-]+):(\d+)$/i.exec(req.url || '');
      const host = m && m[1].toLowerCase();
      if (!m || !Object.hasOwn(this.policy.hosts,host) || Number(m[2]) !== 443 || this.closing) {
        this.c.connectRefused++;
        this.log({ kind: 'connect', host: m ? host : 'malformed', port: m ? Number(m[2]) : null, decision: 'denied', reason: this.closing ? 'closing' : 'host' });
        sock.end('HTTP/1.1 403 Forbidden\r\nx-ss-harness-deny: host\r\ncontent-length: 0\r\n\r\n');
        return;
      }
      this.c.connectAllowed++;
      this.log({ kind: 'connect', host, port: 443, decision: 'tunnel' });
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const t = new tls.TLSSocket(sock, { isServer: true, secureContext: id.ctx[host], ALPNProtocols: ['http/1.1'] });
      t.ssHost = host;
      t.on('error', () => t.destroy());
      this.sockets.add(t); t.on('close', () => this.sockets.delete(t));
      this.inner.emit('connection', t);
    });
    this.watch(this.inner,'error',()=>this.fatal('guard-server-error','inner-server'));
    this.watch(this.server,'error',()=>this.fatal('guard-server-error','proxy-server'));
    this.startAbort=()=>{this.cancelAll('startup-aborted');this.close('startup-aborted').catch(()=>{});};
    this.opts.signal?.addEventListener('abort',this.startAbort,{once:true});
    await listenOwned(this.server,{signal:this.opts.signal,timeoutMs:this.opts.listenerStartTimeoutMs});
    if(this.closing||this.opts.signal?.aborted)throw new Error('HARNESS_LIMITED: guard startup aborted');
    this.port = this.server.address().port;
    this.log({ kind: 'start', port: this.port, hosts, spki: this.spki, pid: process.pid, deadlineAt: this.policy.deadlineAt, caps: this.policy.caps, ledgerUsed: this.ledger.state.used });
    if (this.deadline > Date.now()) this.deadlineTimer = setTimeout(this.guardCallback(() => this.cancelAll('campaign-deadline'),'campaign-deadline'), this.deadline - Date.now()).unref();
    return this;
  }

  async onRequest(req, res) {
    let streamFailed=false,requestRecord=null;
    const streamError=()=>{streamFailed=true;if(requestRecord){requestRecord.ac.abort();requestRecord.finish(req.aborted?'client-aborted':'client-stream-error');}res.destroy();};
    this.watch(req,'error',streamError);this.watch(res,'error',streamError);
    const requestStarted = Date.now();
    this.c.attempted++;
    const host = req.socket.ssHost;
    let u; try { u = new URL(req.url, 'https://' + host); } catch { return this.deny(res, 'malformed', { kind: 'request', host }); }
    const nav = req.headers['sec-fetch-mode'] === 'navigate';
    const ev = { kind: 'request', host, method: req.method, path: this.pathRef(u.pathname), nav, dest: req.headers['sec-fetch-dest'] || null };
    if ((req.headers.host || '').toLowerCase().split(':')[0] !== host) return this.deny(res, 'host-mismatch', ev);
    if (this.closing) return this.deny(res, 'closing', ev);
    if (Date.now() >= this.deadline) return this.deny(res, 'deadline-passed', ev);
    if(!Object.hasOwn(this.policy.hosts,host))return this.deny(res,'unknown-host',ev);
    const rule = matchPolicyRule(this.policy,host,req.method,u.pathname);
    if (!rule) return this.deny(res, 'policy', ev);
    ev.rule = rule.id;
    if (!(await this.slot())) return this.deny(res, 'concurrency-wait', ev);
    if(streamFailed){this.releaseSlot();return;}
    if (this.closing) { this.releaseSlot(); return this.deny(res, 'closing', ev); }
    const keys = ['total', rule.cap].concat(nav ? ['navigations'] : []);
    let over;try{over=this.ledger.tryReserve([...new Set(keys)]);}catch{this.releaseSlot();this.fatal('guard-ledger-integrity','request-reservation');res.destroy();return;}
    if (over) { this.releaseSlot(); this.noteAllowance?.(over); return this.deny(res, 'cap:' + over, ev); }
    const ac = new AbortController();
    const rec = { ev, ac, res, start: requestStarted, outcome: null, forwarded: false, slotHeld: true };
    let completionObservation=null,feedbackObservation=null,feedbackControl=null;
    const key = Symbol('req');
    this.inFlight.set(key, rec);
    this.c.inFlightMax = Math.max(this.c.inFlightMax, this.active);
    const finish = (outcome, extra = {}) => {
      if (rec.outcome) return;
      rec.outcome = outcome;
      try{
      if(feedbackObservation?.index){feedbackControl.finish(feedbackObservation.index,{outcome,status:extra.status,forwarded:rec.forwarded,bodyBuffer:rec.feedbackBodyBuffer,complete:rec.feedbackComplete,responseHeaders:rec.feedbackResponseHeaders});this.log({kind:'feedback-attempt-finished',id:feedbackControl.binding.id,index:feedbackObservation.index,operationDigest:feedbackObservation.operationDigest,outcome,status:extra.status||null,forwarded:rec.forwarded});}
      if(completionObservation?.index){this.completionObserver.finish(completionObservation.index,{outcome,status:extra.status,forwarded:rec.forwarded});this.log({kind:'completion-attempt-finished',faultId:this.completionFaultId,index:completionObservation.index,operationDigest:completionObservation.operationDigest,requestBodySha256:completionObservation.requestBodySha256,outcome,status:extra.status||null,forwarded:rec.forwarded});}
      }catch{this.fatal('guard-callback-failure','attempt-finish');}
      finally{clearTimeout(rec.timer);
      this.inFlight.delete(key); if(rec.slotHeld) {this.releaseSlot();rec.slotHeld=false;}
      this.c.outcomes[outcome] = (this.c.outcomes[outcome] || 0) + 1;
      if (outcome === 'completed') this.c.completed++;
      try{this.log({ ...ev, decision: rec.forwarded ? 'forwarded' : 'not-forwarded', outcome, ms: Date.now() - rec.start, ...extra });}catch{this.fatal('guard-log-unavailable','request-finish');}
      }
    };
    rec.finish = finish;requestRecord=rec;
    const remaining = Math.min(requestStarted + this.policy.requestTimeoutMs, this.deadline) - Date.now();
    const deadline = () => { ac.abort(); finish('deadline'); if (!res.headersSent) { res.writeHead(504, { 'x-ss-harness-deny': 'deadline' }); res.end(); } else res.destroy(); };
    if(remaining <= 0) { deadline(); return; }
    rec.timer = setTimeout(this.guardCallback(deadline,'request-deadline'), remaining);
    this.watch(res,'close', () => { if (!res.writableFinished && !rec.outcome && !rec.intentionalOffline) { ac.abort(); finish('client-aborted'); } });
    let requestBody = null;
    const candidateFault = this.faults.some(f => !f.selected && f.host === host && f.method === req.method && f.path.slice(1,-1) === u.pathname);
    const observedCompletion=this.completionObserver?.matchesRoute({host,method:req.method,pathname:u.pathname});
    const feedbackCandidates=(this.feedbackFaults||[]).filter(f=>f.matchesRoute({host,method:req.method,pathname:u.pathname}));
    if (candidateFault || observedCompletion || feedbackCandidates.length) {
      try { requestBody = await readBoundedBody(req, 1048576, remaining, ac.signal); }
      catch (e) {if(feedbackCandidates.length)feedbackCandidates.at(-1).fail('feedback-body-unavailable'); if(observedCompletion)this.completionObserver.fail('completion-body-unavailable');if(!rec.outcome) { finish('harness-limited', {reason:'fault-body-unavailable'}); this.deny(res, 'fault-body-unavailable', ev); } return; }
    }
    if (rec.outcome || this.closing || Date.now() >= this.deadline) { if(!rec.outcome) deadline(); return; }
    const downloadFault=selectDownloadFault(this.downloadFaults,{url:u.href,method:req.method});
    if(downloadFault?.mode==='offline-mid-download'&&this.browserPrefixObserver){
      try{downloadFault.browserPrefixBinding=await this.browserPrefixObserver.bind(downloadFault.id);}
      catch{finish('harness-limited',{reason:'browser-prefix-request-not-established'});this.deny(res,'browser-prefix-request-not-established',ev);return;}
    }
    if(downloadFault?.mode==='download-fails'){downloadFault.fired=true;this.log({...ev,kind:'download-fault',faultId:downloadFault.id,mode:downloadFault.mode,decision:'not-forwarded'});finish('fault-download-request-lost');req.resume();failConnection(req.socket);return;}
    if(observedCompletion){completionObservation=this.completionObserver.observe({host,method:req.method,pathname:u.pathname,bodyBuffer:requestBody,headers:req.headers});if(completionObservation){this.durableLog({kind:'completion-attempt-reserved',faultId:this.completionFaultId,...completionObservation});if(!completionObservation.permitted){finish('harness-limited',{reason:completionObservation.reason});this.deny(res,'unexpected-completion-attempt',ev);return;}}}
    if(feedbackCandidates.length){
      const request={host,method:req.method,pathname:u.pathname,search:u.search,bodyBuffer:requestBody,headers:req.headers,rawHeaders:req.rawHeaders};
      feedbackControl=feedbackCandidates.find(f=>f.matchesCapturedKey(request))||[...feedbackCandidates].reverse().find(f=>!f.summary().exactExpectedAttempts)||feedbackCandidates.at(-1);
      if(feedbackControl){feedbackObservation=feedbackControl.inspect(request);this.durableLog({kind:'feedback-attempt-reserved',id:feedbackControl.binding.id,...feedbackObservation});
        if(feedbackObservation.action==='deny'){finish('harness-limited',{reason:feedbackObservation.reason});this.deny(res,'unexpected-feedback-attempt',ev);return;}
        if(feedbackObservation.action==='fatal'){finish('feedback-transport-before-send');req.resume();failConnection(req.socket);return;}
        if(feedbackObservation.action==='synthetic-rejection'){rec.feedbackComplete=true;rec.feedbackBodyBuffer=Buffer.from(syntheticRejection.body);finish('feedback-synthetic-42501',{status:syntheticRejection.status});res.writeHead(syntheticRejection.status,{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':feedbackControl.binding.host==='a.test'?'https://a.test':'https://speaksharp-public.vercel.app','vary':'Origin','x-ss-harness-control':'synthetic-feedback-42501'});res.end(syntheticRejection.body);return;}
      }
    }
    const fault = requestBody ? this.matchFault(host, req.method, u.pathname, requestBody, req.headers) : null;
    if (fault && fault.mode === 'request-lost') {
      fault.fired = true;
      this.log({ ...ev, kind: 'fault', faultId: fault.id, mode: fault.mode, operationDigest: fault.operationDigest, decision: 'not-forwarded' });
      finish('fault-request-lost'); req.resume(); failConnection(req.socket); return;
    }
    try{this.reserveTakeForRequest(host,req.method,u.pathname);}catch(e){
      if(e?.code==='TAKE_CAP'){finish('case-take-cap');this.deny(res,'cap:case-takes',ev);return;}
      this.fatal('guard-action-budget-integrity','take-reservation');res.destroy();return;
    }
    if(this.closing||rec.outcome)return;
    this.c.forwarded++; rec.forwarded = true;
    let sock;
    try { sock = await upstreamSocket(this.policy, host, ac.signal); }
    catch (e) {
      if (rec.outcome) return;
      finish('upstream-error', { errorCode:'upstream-unavailable', sent: false });
      if (!res.headersSent) { res.writeHead(502, { 'x-ss-harness-deny': 'upstream-error' }); res.end(); }
      return;
    }
    if (rec.outcome) { sock.destroy(); return; }
    const headers = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i]; if (HOP.has(k.toLowerCase())) continue;
      headers[k] = headers[k] !== undefined ? [].concat(headers[k], req.rawHeaders[i + 1]) : req.rawHeaders[i + 1];
    }
    if(downloadFault?.mode==='offline-mid-download'){for(const k of Object.keys(headers))if(k.toLowerCase()==='accept-encoding')delete headers[k];headers['accept-encoding']='identity';} // compressed/chunked responses carry no Content-Length, so the prefix fault could never fire (AHT-14)
    // http.request over the already-established upstream TLS socket: no agent, no DNS, no second
    // connection. (An agent would ignore createConnection and resolve the host directly.)
    const up = http.request({ createConnection: () => sock, method: req.method, path: u.pathname + u.search, headers, signal: ac.signal });
    this.watch(up,'response', (ur) => {
      const status = ur.statusCode;
      if (status >= 300 && status < 400) {
        this.c.redirectsSeen++;
        const loc = ur.headers.location; let toHost = null;
        try { toHost = new URL(loc, u).hostname; } catch {}
        this.log({ ...ev, kind: 'redirect', status, toHost, toAllowedHost: !!(toHost && Object.hasOwn(this.policy.hosts,toHost)) });
      }
      if(feedbackControl&&feedbackObservation){
        const chunks=[];let bytes=0;
        this.watch(ur,'data',d=>{bytes+=d.length;if(bytes>1048576){feedbackControl.fail('feedback-response-too-large');ac.abort();finish('harness-limited',{reason:'feedback-response-too-large',status,sent:true});res.destroy();}else chunks.push(d);});
        this.watch(ur,'error',()=>{if(!rec.outcome){finish('upstream-error',{status,sent:true});res.destroy();}});
        this.watch(ur,'end',async()=>{
          if(rec.outcome)return;
          const body=Buffer.concat(chunks);rec.feedbackBodyBuffer=body;rec.feedbackComplete=ur.complete===true;rec.feedbackResponseHeaders=ur.headers;
          if(!rec.feedbackComplete){feedbackControl.fail('feedback-response-incomplete');finish('harness-limited',{status,reason:'feedback-response-incomplete',sent:true});res.destroy();return;}
          if(feedbackControl.binding.mode==='stored-response-lost'&&feedbackObservation.index===1){
            if(feedbackControl.canSuppressStoredAcknowledgement({status,complete:ur.complete===true,forwarded:rec.forwarded,bodyBuffer:body,responseHeaders:ur.headers})){
              this.durableLog({kind:'feedback-insert-created-ack-suppressed',id:feedbackControl.binding.id,operationDigest:feedbackObservation.operationDigest,status,bytes,proofPending:'explicit-same-key-named-409',persistedAssociation:'NOT_PROVEN'});
              finish('feedback-stored-response-lost',{status});failConnection(req.socket);return;
            }
            this.log({kind:'feedback-fault-not-fired',id:feedbackControl.binding.id,status,reason:'initial-plain-insert-created-response-unproved'});
          }
          res.writeHead(status,ur.statusMessage,responseHeaders(ur));res.end(body);finish('completed',{status,bytes});
        });return;
      }
      if(downloadFault?.mode==='offline-mid-download' && canInterruptDownload(status,ur.headers['content-length'],downloadFault.afterBytes)) {
        const chunks=[];let held=0;
        this.watch(ur,'data',d=>{
          if(rec.outcome||rec.intentionalOffline)return;
          const take=Math.min(d.length,downloadFault.afterBytes-held);if(take>0){chunks.push(d.subarray(0,take));held+=take;}
          if(held===downloadFault.afterBytes){
            const headers=responseHeaders(ur).filter((_,i,all)=>all[i-(i%2)].toLowerCase()!=='connection');headers.push('Connection','close');
            rec.intentionalOffline=true;res.writeHead(status,ur.statusMessage,headers);
            res.write(Buffer.concat(chunks),this.guardCallback(async()=>{
              if(rec.outcome)return;
              try {
                if(this.browserPrefixObserver)downloadFault.browserPrefixReceipt=await this.browserPrefixObserver.received(downloadFault.browserPrefixBinding);
                await this.offlineControl(true);
                if(rec.outcome)return;
                downloadFault.fired=true;downloadFault.browserOfflineApplied=true;downloadFault.bytesForwarded=held;
                this.log({...ev,kind:'download-fault',faultId:downloadFault.id,mode:downloadFault.mode,upstreamStatus:status,bytesForwarded:held,declaredLength:+ur.headers['content-length'],browserOfflineApplied:true,decision:'browser-offline-after-prefix'});
                finish('fault-download-interrupted',{status,bytes:held});res.end();up.destroy();
              }catch(e){if(!rec.outcome){finish('harness-limited',{reason:'browser-offline-application-unproved'});res.destroy();up.destroy();}}
            },'download-prefix'));

          }
        });
        this.watch(ur,'end',()=>{if(!rec.outcome&&!rec.intentionalOffline){finish('harness-limited',{reason:'download-prefix-not-reached'});failConnection(req.socket);}});
        this.watch(ur,'error',()=>{if(!rec.outcome&&!rec.intentionalOffline){finish('upstream-error',{sent:true});failConnection(req.socket);}});
        return;
      }
      if(downloadFault?.mode==='offline-mid-download')this.log({...ev,kind:'download-fault-not-fired',faultId:downloadFault.id,reason:'HARNESS_LIMITED: successful known content length larger than prefix required',status});
      if (fault && fault.mode === 'response-lost' && status >= 200 && status < 300) {
        const chunks = []; let bytes = 0;
        this.watch(ur,'data', d => { bytes += d.length; if(bytes <= 2097152) chunks.push(d); else { ac.abort(); finish('harness-limited', { reason: 'fault-response-body-limit' }); failConnection(req.socket); } });
        this.watch(ur,'error', () => { if(!rec.outcome) { finish('upstream-error', {status, sent:true}); failConnection(req.socket); } });
        this.watch(ur,'end', async () => {
          if(rec.outcome) return;
          if(ur.complete!==true){finish('harness-limited',{reason:'completion-response-incomplete',status});res.destroy();return;}
          if(rec.slotHeld) {this.releaseSlot();rec.slotHeld=false;} // upstream complete; allow independent readback under same concurrency cap
          const responseCompletedAt = new Date().toISOString();
          const requestReceiptId = 'forwarded-' + this.log({ ...ev, kind: 'upstream-complete', operationDigest: fault.operationDigest, status, bytes });
          try {
            const proof = await this.opts.readbackOracle.readback({ binding: fault, responseCompletedAt, requestReceiptId, signal: ac.signal, request: spec => this.readbackRequest({ ...spec, signal: ac.signal, boundHost: fault.host, inheritedHeaders: req.headers }) });
            if(rec.outcome) return;
            const verified = verifyDurableReadback(fault, { status, complete: true, responseCompletedAt, requestReceiptId, sourceId: 'guard-upstream-response', operationDigest: fault.operationDigest }, proof);
            if (!verified || verified.suppressResponse !== true) throw new Error('readback rejected');
            fault.fired = true;
            this.log({ ...ev, kind: 'fault', faultId: fault.id, mode: fault.mode, operationDigest: fault.operationDigest, upstreamStatus: status, decision: 'response-dropped-after-readback', readbackReceiptId: proof.readbackRequestReceiptId });
            finish('fault-response-lost', { status }); failConnection(req.socket);
          } catch(e) {
            if(rec.outcome) return;
            // No manufactured lost-response success: the complete original response is delivered.
            this.log({ ...ev, kind: 'fault-not-fired', faultId: fault.id, reason: 'HARNESS_LIMITED: durable readback unavailable or invalid' });
            res.writeHead(status, ur.statusMessage, responseHeaders(ur)); res.end(Buffer.concat(chunks));
            finish('harness-limited', {status, reason:'durable-readback-unproven'});
          }
        });
        return;
      }
      if (fault && fault.mode === 'response-lost') this.log({ ...ev, kind: 'fault-not-fired', faultId: fault.id, reason: 'upstream-non-success', status });
      const raw = [];
      for (let i = 0; i < ur.rawHeaders.length; i += 2) if (!HOP.has(ur.rawHeaders[i].toLowerCase())) raw.push(ur.rawHeaders[i], ur.rawHeaders[i + 1]);
      res.writeHead(status, ur.statusMessage, raw);
      let bytes = 0;
      this.watch(ur,'data', (d) => { bytes += d.length; });
      this.watch(ur,'end', () => finish('completed', { status, bytes }));
      this.watch(ur,'error', () => finish('upstream-error', { status, sent: true }));
      ur.pipe(res);
    });
    this.watch(up,'error', (e) => {
      if (rec.outcome) return;
      finish('upstream-error', { errorCode:'upstream-unavailable', sent: 'unknown' });
      if (!res.headersSent) { res.writeHead(502, { 'x-ss-harness-deny': 'upstream-error' }); res.end(); } else res.destroy();
    });
    if (requestBody) up.end(requestBody); else req.pipe(up);
  }

  // Same-account independent readback: exact reviewed GET, shared cumulative caps, normal
  // upstream TLS, no redirects/retries, same concurrency/deadline/cancellation accounting.
  async readbackRequest(spec) {
    const start=Date.now(); const u=new URL(spec.url);
    if(this.closing || spec.signal?.aborted || start>=this.deadline) throw new Error('HARNESS_LIMITED: readback cancelled/deadline');
    if(u.protocol!=='https:' || u.username || u.password || u.hash || (u.port && u.port!=='443') || u.hostname!==spec.boundHost) throw new Error('HARNESS_LIMITED: readback target mismatch');
    const rule=(Object.hasOwn(this.policy.hosts,u.hostname)?this.policy.hosts[u.hostname]:null)?.rules.find(r=>r.methods.includes('GET') && new RegExp(r.path).test(u.pathname));
    if(!rule) throw new Error('HARNESS_LIMITED: readback policy denial');
    this.c.attempted++;
    if(!(await this.slot())) throw new Error('HARNESS_LIMITED: readback concurrency wait');
    if(this.closing || spec.signal?.aborted) {this.releaseSlot();throw new Error('HARNESS_LIMITED: readback cancelled');}
    let over;try {over=this.ledger.tryReserve([...new Set(['total',rule.cap])]);} catch(e) {this.releaseSlot();this.fatal?.('guard-ledger-integrity','readback-reservation');throw new Error('HARNESS_LIMITED: readback ledger integrity');}
    if(over) {this.releaseSlot();this.noteAllowance?.(over);throw new Error('HARNESS_LIMITED: readback cap '+over);}
    const ac=new AbortController(), key=Symbol('readback');
    const rec={ev:{kind:'readback',host:u.hostname,method:'GET',path:this.pathRef(u.pathname),rule:rule.id},ac,res:null,start,outcome:null};
    this.inFlight.set(key,rec);this.c.inFlightMax=Math.max(this.c.inFlightMax,this.active);
    let timer;
    rec.finish=(outcome,extra={})=>{if(rec.outcome)return;rec.outcome=outcome;clearTimeout(timer);this.inFlight.delete(key);this.releaseSlot();this.c.outcomes[outcome]=(this.c.outcomes[outcome]||0)+1;if(outcome==='completed')this.c.completed++;this.log({...rec.ev,outcome,decision:'forwarded',ms:Date.now()-start,...extra});};
    const abort=()=>ac.abort();spec.signal?.addEventListener('abort',abort,{once:true});
    const left=Math.min(start+this.policy.requestTimeoutMs,this.deadline)-Date.now();
    if(left<=0) {rec.finish('deadline');spec.signal?.removeEventListener('abort',abort);throw new Error('HARNESS_LIMITED: readback deadline');}
    timer=setTimeout(()=>ac.abort(),left);rec.timer=timer;
    const startedAt=new Date().toISOString();
    const requestReceiptId='readback-'+this.log({...rec.ev,kind:'readback-reserved',capsReserved:true});
    let sock;
    try {
      const testTransport=this.opts?.offlineReadbackTransport;
      if(testTransport && (!this.policy.testOnly || this.opts.offlineOnly!==true)) throw new Error('offline test transport refused for live policy');
      if(!testTransport) sock=await upstreamSocket(this.policy,u.hostname,ac.signal);
      if(ac.signal.aborted) throw new Error('readback aborted');
      const headers={host:u.hostname,accept:'application/json','connection':'close'};
      // Only the same already-authorized account credentials are propagated, never logged.
      for(const k of ['authorization','apikey']) if(spec.inheritedHeaders?.[k]) headers[k]=spec.inheritedHeaders[k];
      this.c.forwarded++;
      const result=await (testTransport ? abortable(testTransport({url:u.href,method:'GET',headers,signal:ac.signal}),ac.signal) : new Promise((resolve,reject)=>{
        const up=http.request({createConnection:()=>sock,method:'GET',path:u.pathname+u.search,headers,signal:ac.signal},ur=>{
          const chunks=[];let bytes=0;
          this.watch(ur,'data',d=>{bytes+=d.length;if(bytes>1048576){up.destroy(new Error('readback body limit'));reject(new Error('readback body limit'));}else chunks.push(d);});
          ur.once('error',reject);ur.once('end',()=>resolve({body:Buffer.concat(chunks),status:ur.statusCode,complete:ur.complete===true}));
        });up.once('error',reject);up.end();
      }));
      if(!Buffer.isBuffer(result.body) || result.body.length>1048576) throw new Error('readback result invalid');
      if(ac.signal.aborted || rec.outcome) throw new Error('readback cancelled');
      const completedAt=new Date().toISOString();
      rec.finish('completed',{status:result.status,bytes:result.body.length});
      return {...result,receipt:{requestReceiptId,status:result.status,complete:result.complete,startedAt,completedAt,capsReserved:true,method:'GET',urlSha256:crypto.createHash('sha256').update(u.href).digest('hex'),redirectsFollowed:0}};
    } catch(e) {rec.finish(ac.signal.aborted?'cancelled':'upstream-error',{sent:'unknown'});throw new Error('HARNESS_LIMITED: readback unavailable');}
    finally {clearTimeout(timer);spec.signal?.removeEventListener('abort',abort);if(sock)sock.destroy();}
  }

  cancelAll(reason) {
    if(this.cancelled)return;this.cancelled=true;this.closing=true;
    this.browserPrefixObserver?.close();
    const safeReason=/^[a-z-]{1,48}$/.test(reason)?reason:'cancelled';
    try{this.log({kind:'cancel',reason:safeReason,inFlight:this.inFlight.size});}catch{}
    for(const w of this.waiters.splice(0)){clearTimeout(w.timer);try{w.resolve(false);}catch{}}
    for(const [key,rec]of [...this.inFlight]){
      try{rec.ac.abort();}catch{}
      try{if(!rec.outcome)rec.finish('cancelled',{reason:safeReason});}catch{}
      finally{clearTimeout(rec.timer);this.inFlight.delete(key);if(rec.slotHeld){try{this.releaseSlot();}catch{}rec.slotHeld=false;}try{rec.res?.destroy();}catch{}}
    }
  }
  summary() {
    return { fatal:this.fatalState||null, caseAllowance:this.ledger?.caseAllowanceState?.()||null, port: this.port, spki: this.spki, feedbackFaults:(this.feedbackFaults||[]).map(f=>f.summary()), completionAttempts:this.completionObserver?.summary()||null, counters: this.c, ledgerUsed: this.ledger.state.used, caps: this.policy.caps, downloadFaults:this.downloadFaults.map(f=>({id:f.id,mode:f.mode,selected:f.selected,fired:f.fired,bytesForwarded:f.bytesForwarded,browserOfflineApplied:f.browserOfflineApplied===true,networkRestored:f.networkRestored===true,...(f.browserPrefixReceipt?{browserPrefixReceipt:f.browserPrefixReceipt}:{})})), faults: this.faults.map((f) => ({ id: f.id, mode: f.mode, fired: f.fired })) };
  }
  async close(reason = 'close') {
    if(this.closePromise)return this.closePromise;
    this.closePromise=(async()=>{
      this.cancelAll(reason);clearTimeout(this.deadlineTimer);this.opts.signal?.removeEventListener('abort',this.startAbort);
      for(const sock of this.sockets){try{sock.destroy();}catch{}}this.sockets.clear();
      const bound=Number.isSafeInteger(this.opts?.closeTimeoutMs)?Math.max(10,Math.min(2000,this.opts.closeTimeoutMs)):1000;
      await Promise.all([this.inner,this.server].filter(Boolean).map(server=>new Promise(resolve=>{
        let settled=false;const done=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
        const timer=setTimeout(done,bound);try{server.close(done);server.closeAllConnections?.();}catch{done();}
      })));
      let summary;
      try{summary=this.summary();try{this.log({kind:'stop',reason:/^[a-z-]{1,48}$/.test(reason)?reason:'close',summary});}catch{}}
      finally{if(this.logFd!==undefined){try{fs.closeSync(this.logFd);}catch{}this.logFd=undefined;}try{this.ledger?.release();}catch{}}
      return summary;
    })();return this.closePromise;
  }

}
// Deliver a lost request/response as a fatal browser network error. A bare socket close is NOT used:
// Chromium silently re-sends a request (including POST) whose reused connection closes before any
// response bytes, which would turn a "lost" fault into an invisible duplicate. Conflicting
// Content-Length headers are a hard error (ERR_RESPONSE_HEADERS_MULTIPLE_CONTENT_LENGTH) that the
// browser does not retry and cannot read as success.
function failConnection(sock) {
  try { sock.end('HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 2\r\nConnection: close\r\n\r\n'); } catch {}
  setTimeout(() => { try { sock.destroy(); } catch {} }, 200).unref();
}
function abortable(promise,signal) {
  return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('aborted'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
function responseHeaders(ur) {
  const raw = [];
  for(let i=0;i<ur.rawHeaders.length;i+=2) if(!HOP.has(ur.rawHeaders[i].toLowerCase())) raw.push(ur.rawHeaders[i],ur.rawHeaders[i+1]);
  return raw;
}
function readBoundedBody(req, maxBytes, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size=0, settled=false;
    const done = (err, value) => { if(settled) return; settled=true; clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); signal?.removeEventListener('abort', aborted); if(err) reject(err); else resolve(value); };
    const data = d => { size+=d.length; if(size>maxBytes) done(new Error('body too large')); else chunks.push(d); };
    const end = () => done(null,Buffer.concat(chunks)); const error = e => done(e); const aborted=()=>done(new Error('aborted'));
    const timer=setTimeout(()=>done(new Error('body deadline')),Math.max(1,timeoutMs));
    req.on('data',data); req.once('end',end); req.once('error',error); req.once('aborted',aborted); signal?.addEventListener('abort',aborted,{once:true}); if(signal?.aborted) aborted();
  });
}
function safeHost(u) { try { return new URL(u).hostname; } catch { return 'unparsed'; } }

async function startGuard(policy, opts) { if(opts?.signal?.aborted)throw new Error('HARNESS_LIMITED: guard startup aborted');assertSecurityApproval(opts, policy); const guard=new Guard(policy, opts);try{return await guard.start();}catch{await guard.close('startup-failed');throw new Error('HARNESS_LIMITED: guard startup failed');} }
// Owned-listener lifecycle is injectable for fake-only tests; this function itself never creates a server.
function listenOwned(server,{signal,timeoutMs}={}) {
  const bound=Number.isSafeInteger(timeoutMs)?Math.max(10,Math.min(10000,timeoutMs)):10000;
  return new Promise((resolve,reject)=>{
    let settled=false,timer;
    const close=()=>{try{server.close(()=>{});server.closeAllConnections?.();}catch{}};
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);server.off('error',failed);};
    const stop=reason=>{if(settled)return;settled=true;cleanup();close();reject(new Error('HARNESS_LIMITED: '+reason));};
    const abort=()=>stop('guard startup aborted'),failed=()=>stop('guard listener unavailable');
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});server.once('error',failed);
    timer=setTimeout(()=>stop('guard listener startup deadline'),bound);
    try{server.listen(0,'127.0.0.1',()=>{if(settled){close();return;}settled=true;cleanup();resolve();});}catch{failed();}
  });
}
module.exports = { startGuard, validatePolicy, matchPolicyRule, Ledger, Guard, failConnection, listenOwned };
