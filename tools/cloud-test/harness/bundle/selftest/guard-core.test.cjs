'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Ledger,Guard,failConnection,startGuard,validatePolicy}=require('../harness/guard-proxy.cjs');
const {validateSecurityApproval}=require('../harness/approval-gate.cjs');
const {operationDigest}=require('../harness/fault-contract.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function temp(t){const d=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ss-rev3-unit-')));fs.chmodSync(d,0o700);t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
test('ledger reserves cumulative caps before caller can send and never refunds',t=>{const f=path.join(temp(t),'ledger.json');let l=new Ledger(f,{total:2,coaching:1});assert.equal(l.tryReserve(['total','coaching','total']),null);assert.deepEqual(JSON.parse(fs.readFileSync(f)).used,{total:1,coaching:1});assert.equal(l.tryReserve(['total','coaching']),'coaching');assert.equal(l.state.used.total,1);l.release();l=new Ledger(f,{total:2,coaching:1});assert.equal(l.tryReserve(['total']),null);assert.equal(l.tryReserve(['total']),'total');l.release();assert.equal(fs.statSync(f).mode&0o777,0o600);});
test('ledger lock denies concurrent and stale ambiguous owners',t=>{const f=path.join(temp(t),'l');const l=new Ledger(f,{total:1});assert.throws(()=>new Ledger(f,{total:1}),/locked/);l.release();fs.writeFileSync(f+'.lock','99999999');assert.throws(()=>new Ledger(f,{total:1}),/locked/);});
test('ledger caps cannot silently change across runs',t=>{const f=path.join(temp(t),'l');const l=new Ledger(f,{total:1});l.tryReserve(['total']);l.release();assert.throws(()=>new Ledger(f,{total:2}),/mismatch/);assert.equal(fs.existsSync(f+'.lock'),false);});
test('ledger unknown cap, empty keys, zero cap and invalid cap fail closed',t=>{const f=path.join(temp(t),'l');assert.throws(()=>new Ledger(f,{total:NaN}),/invalid cap/);const l=new Ledger(f,{total:0});assert.throws(()=>l.tryReserve(['missing']),/unknown/);assert.throws(()=>l.tryReserve([]),/empty/);assert.equal(l.tryReserve(['total']),'total');l.release();});
test('ledger refuses corrupt historical state and cleans own lock',t=>{const f=path.join(temp(t),'l');fs.writeFileSync(f,'{"used":{},"reservations":0}');assert.throws(()=>new Ledger(f,{total:1}),/mismatch/);assert.equal(fs.existsSync(f+'.lock'),false);});
test('ledger refuses symlink',t=>{const d=temp(t),f=path.join(d,'l');fs.writeFileSync(path.join(d,'other'),'{}');fs.symlinkSync(path.join(d,'other'),f);assert.throws(()=>new Ledger(f,{total:1}),/symlink/);});
test('synchronous slot grants never exceed maxInFlight',async()=>{const o={active:0,policy:{maxInFlight:2,queueWaitMs:200},waiters:[]};assert.equal(await Guard.prototype.slot.call(o),true);assert.equal(await Guard.prototype.slot.call(o),true);let granted=false;const third=Guard.prototype.slot.call(o).then(x=>{granted=x;return x;});assert.equal(o.active,2);assert.equal(granted,false);Guard.prototype.releaseSlot.call(o);assert.equal(await third,true);assert.equal(o.active,2);Guard.prototype.releaseSlot.call(o);Guard.prototype.releaseSlot.call(o);assert.equal(o.active,0);});
test('queue wait timeout does not allocate a slot',async()=>{const o={active:1,policy:{maxInFlight:1,queueWaitMs:5},waiters:[]};assert.equal(await Guard.prototype.slot.call(o),false);assert.equal(o.active,1);assert.equal(o.waiters.length,0);});
test('fatal fault bytes retain conflicting content lengths, not bare close',()=>{let bytes;const sock={end:b=>bytes=b,destroy(){}};failConnection(sock);assert.match(bytes,/Content-Length: 1\r\nContent-Length: 2/);assert.match(bytes,/Connection: close/);});
test('all network/certificate start paths reject absent approval before action',async()=>{await assert.rejects(startGuard({hosts:{}},{}),/APPROVAL_REQUIRED/);await assert.rejects(Guard.prototype.start.call({opts:{},policy:{hosts:{}}}),/APPROVAL_REQUIRED/);});
const now=Date.parse('2026-10-27T12:00:00Z'), hash='a'.repeat(64);
const expected={runtime:'Claude SpeakSharp R4',codeManifestSha256:hash,hosts:['a.test']};
const approved={version:1,runtime:expected.runtime,action:'ephemeral-browser-spki-exception',ownerApprovalReference:'SYNTHETIC UNIT TEST ONLY',approvedBy:'fixture',approvalSource:'explicit-user-message',reviewedCodeManifestSha256:hash,notBefore:'2026-10-27T11:00:00Z',expiresAt:'2026-10-27T13:00:00Z',allowedHosts:['a.test'],installTrustRoot:false,globalCertificateBypass:false,environmentSecurityChanges:false};
test('approval record validation does not create actual approval/runtime proof',()=>{assert.equal(validateSecurityApproval(approved,expected,now).status,'RECORD_VALID_NOT_RUNTIME_PROOF');});
for(const [name,patch] of [['wrong runtime',{runtime:'another runtime'}],['missing approval',{ownerApprovalReference:null}],['wrong bytes',{reviewedCodeManifestSha256:'b'.repeat(64)}],['expired',{expiresAt:'2026-10-27T11:59:00Z'}],['wrong host',{allowedHosts:['b.test']}],['trust root',{installTrustRoot:true}],['global bypass',{globalCertificateBypass:true}],['environment change',{environmentSecurityChanges:true}]])test('approval rejects '+name,()=>assert.throws(()=>validateSecurityApproval({...approved,...patch},expected,now),/APPROVAL_REQUIRED/));
test('template policy rejects review and null values',()=>assert.throws(()=>validatePolicy(require('../config/policy.production.TEMPLATE.json')),/policy invalid/));
const pointers={account:'/account',take:'/take',completion:'/completion'},body=Buffer.from(JSON.stringify({account:'test-account',take:'test-take',completion:'test-op'}));
const binding={id:'unit-fault',mode:'request-lost',host:'a.test',method:'POST',path:'^/save$',operationPointers:pointers,operationDigest:operationDigest(JSON.parse(body),pointers),requestBodySha256:sha(body),oracleSourceSha256:'a'.repeat(64),oracleSourceId:'unit-readback'};
test('integrated matcher does not consume a different operation',()=>{const f={...binding,selected:false,fired:false};const o={faults:[f],log(){},durableLog(){}};assert.equal(Guard.prototype.matchFault.call(o,'a.test','POST','/save',Buffer.from('{}')),undefined);assert.equal(f.selected,false);assert.equal(Guard.prototype.matchFault.call(o,'a.test','POST','/save',body),f);assert.equal(f.selected,true);assert.equal(f.fired,false);assert.equal(Guard.prototype.matchFault.call(o,'a.test','POST','/save',body),undefined);});
test('response-lost arm refuses absent or wrong independent oracle',()=>{const o={opts:{},faults:[],log(){}};assert.throws(()=>Guard.prototype.armFault.call(o,{...binding,mode:'response-lost'}),/HARNESS_LIMITED/);o.opts.readbackOracle={sha256:'b'.repeat(64),sourceId:'unit-readback',readback(){}};assert.throws(()=>Guard.prototype.armFault.call(o,{...binding,mode:'response-lost'}),/HARNESS_LIMITED/);});
function readbackHarness(t,transport,caps={total:4,read:4}) {
 // These controls test transport/cap ownership, not host fsync performance.
 // Keep real abort timers; move Date explicitly in the deadline control below.
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const file=path.join(temp(t),'ledger');const ledger=new Ledger(file,caps);t.after(()=>ledger.release());
 const logs=[];const o={policy:{testOnly:true,hosts:{'a.test':{rules:[{id:'read',methods:['GET'],path:'^/rows$',cap:'read'}]}},caps,maxInFlight:1,queueWaitMs:5,requestTimeoutMs:40},opts:{offlineOnly:true,offlineReadbackTransport:transport},ledger,active:0,waiters:[],inFlight:new Map(),deadline:Date.now()+1000,closing:false,c:{attempted:0,forwarded:0,completed:0,inFlightMax:0,outcomes:{}},log(e){logs.push(e);return logs.length;},pathRef(p){return sha(p);},slot:Guard.prototype.slot,releaseSlot:Guard.prototype.releaseSlot};return {o,ledger,logs};
}
test('independent readback reserves shared caps before fake transport and returns attributable receipt',async t=>{let called=0;let h;h=readbackHarness(t,async req=>{called++;assert.equal(h.ledger.state.used.total,1);assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'unit-test-token');assert.equal(req.headers.cookie,undefined);return {status:200,complete:true,body:Buffer.from('[{"saved":true}]')};});const r=await Guard.prototype.readbackRequest.call(h.o,{url:'https://a.test/rows?id=eq.unit',boundHost:'a.test',inheritedHeaders:{authorization:'unit-test-token',cookie:'must-not-forward'}});assert.equal(called,1);assert.equal(r.receipt.capsReserved,true);assert.equal(r.receipt.redirectsFollowed,0);assert.equal(h.o.active,0);assert.equal(h.o.inFlight.size,0);assert.equal(h.o.c.completed,1);assert.equal(JSON.stringify(h.logs).includes('unit-test-token'),false);});
test('independent readback exhausted cap sends nothing',async t=>{let calls=0;const h=readbackHarness(t,async()=>{calls++;},{total:0,read:0});await assert.rejects(Guard.prototype.readbackRequest.call(h.o,{url:'https://a.test/rows',boundHost:'a.test'}),/cap/);assert.equal(calls,0);assert.equal(h.o.active,0);});
test('independent readback path/host policy denial sends nothing',async t=>{let calls=0;const h=readbackHarness(t,async()=>{calls++;});await assert.rejects(Guard.prototype.readbackRequest.call(h.o,{url:'https://b.test/rows',boundHost:'a.test'}),/target/);await assert.rejects(Guard.prototype.readbackRequest.call(h.o,{url:'https://a.test/not-rows',boundHost:'a.test'}),/policy/);assert.equal(calls,0);assert.equal(h.ledger.state.reservations,0);});
test('independent readback abort retains reservation and releases ownership',async t=>{const h=readbackHarness(t,()=>new Promise(()=>{}));const controller=new AbortController();const p=Guard.prototype.readbackRequest.call(h.o,{url:'https://a.test/rows',boundHost:'a.test',signal:controller.signal});setTimeout(()=>controller.abort(),5);await assert.rejects(p,/unavailable/);assert.equal(h.ledger.state.reservations,1);assert.equal(h.o.active,0);assert.equal(h.o.inFlight.size,0);});
test('independent readback never follows redirect response',async t=>{let calls=0;const h=readbackHarness(t,async()=>{calls++;return {status:302,complete:true,body:Buffer.from('')};});const r=await Guard.prototype.readbackRequest.call(h.o,{url:'https://a.test/rows',boundHost:'a.test'});assert.equal(calls,1);assert.equal(r.status,302);assert.equal(r.receipt.redirectsFollowed,0);});
test('reservation crossing the request deadline stays spent and sends no readback',async t=>{
 let calls=0;const h=readbackHarness(t,async()=>{calls++;return {status:200,complete:true,body:Buffer.from('[]')};});
 const reserve=h.ledger.tryReserve.bind(h.ledger);
 h.ledger.tryReserve=keys=>{const result=reserve(keys);t.mock.timers.tick(41);return result;};
 await assert.rejects(Guard.prototype.readbackRequest.call(h.o,{url:'https://a.test/rows',boundHost:'a.test'}),/readback deadline/);
 assert.equal(calls,0);assert.equal(h.ledger.state.reservations,1);
 assert.equal(h.o.active,0);assert.equal(h.o.inFlight.size,0);assert.equal(h.o.c.forwarded,0);
});
test('offline transport cannot substitute into a live policy',async t=>{let calls=0;const h=readbackHarness(t,async()=>{calls++;});h.o.policy.testOnly=false;await assert.rejects(Guard.prototype.readbackRequest.call(h.o,{url:'https://a.test/rows',boundHost:'a.test'}),/unavailable/);assert.equal(calls,0);});

// Sam 1794154809 / 1794155156: closed guard upstream reasons and proxy-configuration booleans (never values) so a run proves its own
// egress configuration. Run 42496837188's AHT-01 failed at page.goto with a guard upstream-error that carried no reason.
const { upstreamReason, proxyConfig, upstreamSocket, UPSTREAM_REASONS } = require('../harness/guard-proxy.cjs');

function withEnv(t, vars) {
  const keys = ['HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  t.after(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}
const policy = (upstream) => ({ upstream, hosts: { 'app.test': {}, 'api.test': {} } });

test('upstream errors map to a closed reason; an explicit tag wins; anything else is other', () => {
  const tagged = Object.assign(new Error('x'), { upstreamReason: 'proxy-not-configured' });
  assert.equal(upstreamReason(tagged), 'proxy-not-configured');
  for (const [code, reason] of [['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'], ['ECONNREFUSED', 'connect-refused'], ['ETIMEDOUT', 'timeout'],
    ['ECONNRESET', 'reset'], ['EPIPE', 'reset'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'], ['CERT_HAS_EXPIRED', 'tls'], ['EWHATEVER', 'other']]) {
    assert.equal(upstreamReason(Object.assign(new Error('secret message with host proxy.example:3128'), { code })), reason, code);
  }
  assert.equal(upstreamReason(Object.assign(new Error('x'), { upstreamReason: 'not-a-reason' })), 'other');
  assert.equal(upstreamReason(null), 'other');
  for (const r of UPSTREAM_REASONS) assert.match(r, /^[a-z]+(-[a-z]+)*$/);
});

test('proxy configuration is recorded as presence and validity booleans, never the value', (t) => {
  withEnv(t, {});
  assert.deepEqual(proxyConfig(policy({ mode: 'env-proxy' })), { mode: 'env-proxy', proxyConfigured: false, proxyValid: false, noProxyMatched: false });
  withEnv(t, { HTTPS_PROXY: 'http://user:s3cr3t@proxy.internal.example:3128' });
  const c = proxyConfig(policy({ mode: 'env-proxy' }));
  assert.deepEqual(c, { mode: 'env-proxy', proxyConfigured: true, proxyValid: true, noProxyMatched: false });
  for (const leak of ['s3cr3t', 'user', 'proxy.internal', '3128']) assert.ok(!JSON.stringify(c).includes(leak), leak);
  withEnv(t, { https_proxy: 'not a url' });
  assert.deepEqual(proxyConfig(policy({ mode: 'env-proxy' })), { mode: 'env-proxy', proxyConfigured: true, proxyValid: false, noProxyMatched: false });
  withEnv(t, { HTTPS_PROXY: 'ftp://proxy.example', NO_PROXY: '.test' });
  assert.deepEqual(proxyConfig(policy({ mode: 'env-proxy' })), { mode: 'env-proxy', proxyConfigured: true, proxyValid: false, noProxyMatched: true });
});

test('the production env-proxy path with no proxy refuses as proxy-not-configured, with zero network calls', async (t) => {
  withEnv(t, {});
  const ac = new AbortController();
  await assert.rejects(upstreamSocket({ upstream: { mode: 'env-proxy' } }, 'app.test', ac.signal),
    (e) => e.upstreamReason === 'proxy-not-configured' && upstreamReason(e) === 'proxy-not-configured');
  withEnv(t, { HTTPS_PROXY: 'http://[bad' });
  await assert.rejects(upstreamSocket({ upstream: { mode: 'env-proxy' } }, 'app.test', ac.signal),
    (e) => upstreamReason(e) === 'proxy-invalid');
  await assert.rejects(upstreamSocket({ upstream: { mode: 'env-proxy', caFile: '/nonexistent' } }, 'app.test', ac.signal),
    (e) => upstreamReason(e) === 'test-only-trust');
});
