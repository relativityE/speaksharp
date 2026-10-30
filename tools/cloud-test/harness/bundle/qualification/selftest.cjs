#!/usr/bin/env node
'use strict';
// selftest.cjs --browser <browser.json> --out <dir> [--lighthouse-cli <path>]
// Loopback-only qualification of the guarded browser lane. No production host is contacted:
// the policy is testOnly, upstream goes only to loopback fixtures, and the browser cannot resolve
// any name. Each check compares the guard's own log/counters with the fixtures' independent logs.
// Prints PASS/FAIL per check and writes selftest-results.json. Exit 0 only if every check passes.
const fs = require('fs');
const crypto = require('crypto');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const QUAL_STARTED_AT = new Date().toISOString();
const liveHandles=new Set(), ownedChildren=new Set(), pendingLaunches=new Set();
let stoppingRequested=false;
const FIXTURE_SOURCE_SHA = '0000000000000000000000000000000000000003';
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const H = path.join(__dirname, '..', 'harness');
const { launchGuarded: rawLaunchGuarded, inspectDescendants, checkSandboxedProcesses, sandboxReport } = require(path.join(H, 'launch.cjs'));
const {LIGHTHOUSE_IDS,selection,validateSelectionApproval,summarizeQualification}=require(path.join(H,'qualification-capabilities.cjs'));
const { assertSecurityApproval } = require(path.join(H, 'approval-gate.cjs'));
const { verifyReviewedStep } = require(path.join(H, 'reviewed-step.cjs'));
const { loadReviewedOracle, readbackRequestHash } = require(path.join(H, 'reviewed-oracle-loader.cjs'));
const { operationDigest } = require(path.join(H, 'fault-contract.cjs'));
let approvedOracle;
const { startFixtures } = require('./fixtures.cjs');
const {runFeedbackControls}=require('./feedback-controls.cjs');

const a = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
if (!a.browser || !a.out || !a['security-approval'] || !a['private-media-parent'] || !a['step-manifest'] || !a['step-manifest-sha256']) { console.error('usage: selftest.cjs --browser <browser.json> --out <dir> [--lighthouse-cli <path>]'); process.exit(2); }
const lighthouseSelection=selection(a['lighthouse-selection']||'required');
if(lighthouseSelection==='required'&&(!a['lighthouse-cli']||require(path.join(H,'launch-boundary.cjs')).hashExecutable(a['lighthouse-cli'],a['lighthouse-cli-sha256']).sha256!==a['lighthouse-cli-sha256']))throw new Error('selected Lighthouse executable required');
if(lighthouseSelection==='not-selected'&&a['lighthouse-cli'])throw new Error('unselected Lighthouse must not bind executable');
const capabilityApproval=validateSelectionApproval(lighthouseSelection,JSON.parse(fs.readFileSync(a['security-approval'],'utf8')));
process.exitCode = 3; // a run that ends without reaching the verdict is never a pass
// SOURCE-ONLY port until actually qualified in the selected R0 runtime. No self-issued approval.
const OUT = path.resolve(a.out);
if (fs.existsSync(OUT)) { console.error('BLOCKED_SETUP: --out must be a fresh run-owned directory'); process.exit(2); }
const browserInfo = JSON.parse(fs.readFileSync(a.browser, 'utf8'));
let installedPlaywright=null, expectedExecutable=null, installedChromiumRevision=null;
try {
  installedPlaywright=require(require.resolve('playwright/package.json',{paths:[process.cwd()]})).version;
  expectedExecutable=require(require.resolve('playwright',{paths:[process.cwd()]})).chromium.executablePath();
  installedChromiumRevision=expectedExecutable.split(path.sep).find(part=>/^chromium-[0-9]+$/.test(part))||null;
} catch {}
// Owner policy: record and qualify this installed compatibility tuple, never enforce obsolete pins
// or silently select a different browser. Admission binds the same observed tuple to the campaign.
if (!/^v[0-9]+\.[0-9]+\.[0-9]+/.test(process.version) || !installedPlaywright || installedPlaywright!==browserInfo.playwrightVersion || !installedChromiumRevision || installedChromiumRevision!==browserInfo.revision || !expectedExecutable || !fs.existsSync(expectedExecutable)) {
  console.error('BLOCKED_SETUP: observed Node/Playwright/installed expected Chromium tuple is missing or differs from browser discovery'); process.exit(78);
}
assertSecurityApproval({ securityApprovalFile: a['security-approval'] }, { hosts: { 'a.test': {}, 'c.test': {}, 'd.test': {} } });
const reviewOptions = { manifestFile: a['step-manifest'], expectedManifestSha256: a['step-manifest-sha256'], stepRoot: __dirname };
for (const file of ['steps/ok.cjs', 'steps/hang.cjs', 'steps/throws.cjs', 'steps/allowance-case.cjs', 'durable-oracle.cjs']) verifyReviewedStep({ ...reviewOptions, stepFile: path.join(__dirname, file) });
const readbackBinding = { host:'a.test', method:'GET', pathname:'/saved', search:'' };
approvedOracle = loadReviewedOracle({ ...reviewOptions, oracleFile:path.join(__dirname,'durable-oracle.cjs'), sourceId:'fixture-independent-durable-readback', readbackBinding });
const launchGuarded = async opts => {
  if(stoppingRequested)throw new Error('qualification stopping; no new browser launch');
  const pending=rawLaunchGuarded({ ...opts, securityApprovalFile:a['security-approval'], privateMediaParent:a['private-media-parent'], readbackOracle:approvedOracle });
  pendingLaunches.add(pending);
  try { const handle=await pending; liveHandles.add(handle); if(stoppingRequested)throw new Error('qualification stopped during launch'); return handle; }
  finally {pendingLaunches.delete(pending);}
};
fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
const results = [];
function check(id, desc, ok, detail) { results.push({ id, desc, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${desc}${ok ? '' : ' :: ' + String(JSON.stringify(detail)).slice(0, 600)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
let FX; let runN = 0;

function policy(over = {}) {
  const p = {
    version: 1, sourceSha: FIXTURE_SOURCE_SHA, testOnly: true, logPaths: true,
    hosts: {
      'a.test': { port: 443, rules: [
        { id: 'a-read', methods: ['GET', 'HEAD'], path: '^/(|page|img-page|worker-page|chain[123]|redir-[a-z-]+|img-redir-cross|fetch-redir-cross|gz|img\\.png|ok|get-only|slow|hang|worker\\.js|sw\\.js|ws|nav[0-9]+|saved|model\\.bin|model-gz\\.bin|model-gz2\\.bin|model-error\\.bin)$', cap: 'public' },
        { id: 'a-write', methods: ['POST'], path: '^/(post|beacon|save|save-error)$', cap: 'public' },
        { id: 'a-coach', methods: ['POST'], path: '^/coach$', cap: 'coaching' },
      ] },
      'c.test': { port: 443, rules: [{ id: 'c-api', methods: ['GET', 'POST', 'OPTIONS'], path: '^/(ok|cors-post)$', cap: 'public' }] },
      'd.test': { port: 443, rules: [{ id: 'd-any', methods: ['GET'], path: '^/.*$', cap: 'public' }] },
    },
    caps: { total: 1000, navigations: 200, public: 1000, coaching: 2 },
    maxInFlight: 6, queueWaitMs: 10000, requestTimeoutMs: 8000,
    deadlineAt: new Date(Date.now() + 30 * 60000).toISOString(),
    upstream: { mode: 'override', override: FX.override, caFile: FX.caFile },
  };
  for (const host of Object.values(p.hosts)) for (const rule of host.rules) rule.reviewedSourceSha = FIXTURE_SOURCE_SHA;
  return { ...p, ...over, caps: { ...p.caps, ...(over.caps || {}) } };
}
function fxMark() { return Object.fromEntries(Object.entries(FX.logs).map(([k, L]) => [k, L.read().length])); }
function fxSince(mark, k) { return FX.logs[k].read().slice(mark[k]); }
const SENT = new Set(['completed', 'deadline', 'cancelled', 'client-aborted', 'fault-response-lost', 'fault-download-interrupted', 'feedback-stored-response-lost']);
function forwardedTo(glog, host) { return glog.filter((e) => ['request','readback'].includes(e.kind) && e.host === host && e.decision === 'forwarded' && (SENT.has(e.outcome) || (e.outcome === 'upstream-error' && e.sent === true) || (e.outcome === 'harness-limited' && ((e.reason === 'feedback-durable-readback-unproved' && e.status >= 200 && e.status < 300) || (e.sent === true && ['feedback-response-incomplete','feedback-response-too-large'].includes(e.reason) && Number.isInteger(e.status)))))); }
function reconcile(id, glog, mark, hosts = ['a.test', 'c.test']) {
  const key = { 'a.test': 'a', 'c.test': 'c' };
  for (const h of hosts) {
    const g = forwardedTo(glog, h).map((e) => e.method + ' ' + e.path).sort();
    const f = fxSince(mark, key[h]).filter((e) => !e.upgrade).map((e) => e.method + ' ' + e.path).sort();
    check(id + '.reconcile.' + h, `guard forwarded to ${h} == ${h} fixture log`, JSON.stringify(g) === JSON.stringify(f), { guard: g, fixture: f });
  }
  const leaks = ['b', 'bhttp'].map((k) => fxSince(mark, k).length);
  check(id + '.no-leak', 'forbidden fixtures b.test and plain-HTTP loopback received nothing', leaks[0] === 0 && leaks[1] === 0, { b: leaks[0], bhttp: leaks[1] });
}

async function withGuard(id, pol, fn, ledgerFile) {
  const dir = path.join(OUT, 'runs', String(++runN).padStart(2, '0') + '-' + id);
  const mark = fxMark();
  const h = await launchGuarded({ browserJson: a.browser, policy: pol, runDir: dir, ledgerFile: ledgerFile || path.join(dir, 'ledger.json'), logFile: path.join(dir, 'guard.jsonl') });
  const page = await h.context.newPage();
  let err = null;
  try { await fn({ ...h, page, dir }); } catch (e) { err = e; }
  h.guard.cancelAll('test-end');
  await h.browser.close();
  const summary = await h.guard.close('test-end'); h.cleanupMedia(); liveHandles.delete(h);
  const glog = readJsonl(path.join(dir, 'guard.jsonl'));
  if (err) check(id + '.no-exception', 'test body ran without harness exception', false, String(err.stack || err).slice(0, 400));
  return { summary, glog, mark, dir };
}
const nav = async (page, url) => { try { const r = await page.goto(url, { timeout: 15000 }); return { status: r && r.status(), url: page.url(), deny: r && (await r.headerValue('x-ss-harness-deny')) }; } catch (e) { return { error: String(e.message).split('\n')[0] }; } };
const evalFetch = (page, url, init) => page.evaluate(async ([u, i]) => { try { const r = await fetch(u, i); return { status: r.status, deny: r.headers.get('x-ss-harness-deny'), body: (await r.text()).slice(0, 40), url: r.url }; } catch (e) { return { error: String(e) }; } }, [url, init || {}]);

let childN = 0;
function runNode(args, opts = {}) {
  // Child output goes to files (evidence, and no unread pipe can ever block a child).
  const base = path.join(OUT, 'child-' + String(++childN).padStart(2, '0'));
  const fd = fs.openSync(base + '.log', 'w');
  fs.writeFileSync(base + '.argv.json', JSON.stringify(args));
  const child = spawn(process.execPath, args, { stdio: ['ignore', fd, fd], ...opts }); fs.closeSync(fd); ownedChildren.add(child); child.once('exit',()=>ownedChildren.delete(child)); return child;
}
function waitExit(cp, ms) { if(cp.exitCode !== null || cp.signalCode !== null) return Promise.resolve({code:cp.exitCode,sig:cp.signalCode}); return new Promise((r) => { const t = setTimeout(() => r({ timeout: true }), ms); cp.on('exit', (code, sig) => { clearTimeout(t); r({ code, sig }); }); }); }
function chromePids() { const r = spawnSync('pgrep', ['-f', '^/var/tmp/ss-harness/chrome-linux/chrome'], { encoding: 'utf8' }); return r.stdout.split('\n').filter(Boolean).map(Number); }
async function waitFor(pred, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(100); } return pred(); }

let closePromise=null, stopPromise=null;
async function closeOwned(reason) {
  if(closePromise) return closePromise;
  closePromise=(async()=>{
    stoppingRequested=true; const cleanupErrors=[];
    if(pendingLaunches.size) { const settled=await Promise.race([Promise.allSettled([...pendingLaunches]).then(()=>true),sleep(35000).then(()=>false)]);if(!settled)cleanupErrors.push('browser-launch-cleanup-timeout'); }
    for(const child of ownedChildren) try { child.kill('SIGTERM'); } catch {}
    for(const h of liveHandles) {
      try { h.guard.cancelAll(reason); } catch(e) {cleanupErrors.push('guard-cancel:'+e.message);}
      try { await Promise.race([h.browser.close(),sleep(5000)]); } catch(e) {cleanupErrors.push('browser-close:'+e.message);}
      try { await h.guard.close(reason); } catch(e) {cleanupErrors.push('guard-close:'+e.message);}
      try { h.cleanupMedia(); } catch(e) {cleanupErrors.push('media-cleanup:'+e.message);}
      liveHandles.delete(h);
    }
    for(const child of ownedChildren) try { child.kill('SIGKILL'); } catch {}
    for(const proc of inspectDescendants()) try { process.kill(proc.pid,'SIGKILL'); } catch {}
    for(let i=0;i<50 && inspectDescendants().length;i++) await sleep(100);
    let fixturesClosed=!FX;
    if(FX) {
      try { const result=await Promise.race([FX.close().then(()=>true),sleep(5000).then(()=>false)]); fixturesClosed=result===true; if(!fixturesClosed)cleanupErrors.push('fixture-close-timeout'); }
      catch(e) {cleanupErrors.push('fixture-close:'+e.message);}
      if(fixturesClosed)FX=null;
    }
    return {fixturesClosed,cleanupErrors,ownedProcessesRemaining:inspectDescendants().map(p=>({pid:p.pid,name:p.name}))};
  })();
  return closePromise;
}
async function stopQualification(reason,code,error) {
  if(stopPromise)return stopPromise;
  stopPromise=(async()=>{
    stoppingRequested=true;clearTimeout(qualificationTimer);clearInterval(parentWatch);
    const cleanup=await closeOwned(reason);
    fs.writeFileSync(path.join(OUT,'qualification-error.json'),JSON.stringify({result:'FAIL',reason,error:error?String(error.message||error):null,results,startedAt:QUAL_STARTED_AT,endedAt:new Date().toISOString(),...cleanup},null,2)+'\n',{mode:0o600});
    console.error('QUALIFICATION STOPPED '+reason);process.exit(code);
  })();return stopPromise;
}
const parentAtStart=process.ppid;
const qualificationTimer=setTimeout(()=>stopQualification('qualification-deadline',4),19*60*1000); // reserves one minute for cleanup inside A6's20-minute envelope
const parentWatch=setInterval(()=>{if(process.ppid!==parentAtStart)stopQualification('parent-lost',5);},500);
for(const [signal,number] of [['SIGTERM',15],['SIGINT',2],['SIGHUP',1]])process.on(signal,()=>stopQualification('signal:'+signal,128+number));

(async () => {
  FX = await startFixtures(path.join(OUT, 'fixtures'));
  const env = { node: process.version, browser: JSON.parse(fs.readFileSync(a.browser, 'utf8')) };
  check('S0.precondition', 'no harness Chromium running before the self-test', chromePids().length === 0, chromePids());

  // ---------- S1 sandbox and privilege ----------
  let r = await withGuard('sandbox', policy(), async ({ context }) => {
    const sb = await sandboxReport(context);
    check('S1.sandbox-page', 'chrome://sandbox: namespace + seccomp-BPF, "adequately sandboxed"', sb.adequate && sb.namespace && sb.seccomp, sb.text);
    const procs = inspectDescendants();
    const c = checkSandboxedProcesses(procs);
    check('S1.process-privileges', 'every Chromium descendant uid/gid 65534, no groups, CapEff/CapPrm 0, no sandbox-weakening flag', c.ok && c.chromeProcesses >= 3, c);
    check('S1.renderer-seccomp', 'every renderer runs under seccomp filter mode 2', c.renderers >= 1 && c.renderersWithSeccomp === c.renderers, c);
    check('S1.one-browser-process', 'exactly one browser (non --type) process, launched through the wrapper', c.browserProcesses === 1, c.byType);
    fs.writeFileSync(path.join(OUT, 'sandbox-processes.json'), JSON.stringify({ sandboxPage: sb, processes: procs }, null, 2));
    let threw = 0;
    try { await context.request.get('https://a.test/ok'); } catch { threw++; }
    try { await context.route('**/*', () => {}); } catch { threw++; }
    const p2 = await context.newPage();
    try { await p2.request.post('https://a.test/post'); } catch { threw++; }
    try { await p2.route('**/*', () => {}); } catch { threw++; }
    check('S1.node-network-disabled', 'selected Playwright request/route APIs disabled; native Node scope is reviewed, not sandboxed', threw === 4, threw);
  });
  {
    const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));
    let refused = false; let msg = '';
    try { const br = await chromium.launch({ executablePath: env.browser.wrapperPath, chromiumSandbox: false, timeout: 15000, env:{...process.env,SS_HARNESS_NODE:process.execPath,SS_HARNESS_BUNDLE_ROOT:path.resolve(H,'..'),SS_HARNESS_APPROVAL_FILE:path.resolve(a['security-approval']),SS_HARNESS_LAUNCH_MODE:'guarded',SS_HARNESS_GUARD_PORT:'4321',SS_HARNESS_GUARD_SPKI:'A'.repeat(43)+'='} }); await br.close(); } catch (e) { refused = true; msg = String(e.message).split('\n').filter((l) => /chrome-wrapper|Failed to launch/.test(l)).join(' | '); }
    check('S1.wrapper-refuses-no-sandbox', 'launch with chromiumSandbox:false (adds --no-sandbox) is refused by the wrapper', refused && /refused invocation: forbidden browser flag --no-sandbox/.test(msg), msg);
  }

  // ---------- S2 navigation, redirects, subresources ----------
  r = await withGuard('redirects', policy(), async ({ page }) => {
    let x = await nav(page, 'https://a.test/page');
    check('S2.allowed-page', 'allowed page and its subresource load through the guard', x.status === 200 && (await page.textContent('#t')) === 'hello', x);
    x = await nav(page, 'https://a.test/redir-nav-cross');
    check('S2.nav-redirect-cross', 'navigation 302 to forbidden b.test: next hop refused at CONNECT', !!x.error, x);
    await nav(page, 'https://a.test/img-page'); await sleep(800);
    x = await nav(page, 'https://a.test/chain1');
    check('S2.nav-chain', 'same-origin 302->301->200 navigation chain: every hop re-checked and logged', x.status === 200 && x.url === 'https://a.test/chain3', x);
    await nav(page, 'https://a.test/page');
    x = await evalFetch(page, '/chain1');
    check('S2.fetch-chain', 'same-origin fetch redirect chain completes hop by hop', x.status === 200 && x.url === 'https://a.test/chain3', x);
    x = await evalFetch(page, '/fetch-redir-cross', { mode: 'no-cors' });
    check('S2.fetch-redirect-cross', 'no-cors fetch redirect to b.test fails (CORS cannot mask it)', !!x.error, x);
    x = await nav(page, 'https://a.test/redir-forbidden-path');
    check('S2.redirect-forbidden-path', 'same-origin redirect to a forbidden path is denied by path policy', x.status === 403 && x.deny === 'policy', x);
    x = await nav(page, 'https://a.test/redir-allowed-cross');
    check('S2.redirect-allowed-cross', 'redirect to another allowed host is re-checked and allowed', x.status === 200 && x.url === 'https://c.test/ok', x);
    x = await nav(page, `https://a.test/redir-loopback?port=${FX.ports.bhttp}`);
    check('S2.redirect-loopback', 'redirect to plain-HTTP loopback is denied (no loopback bypass)', x.status === 403 || !!x.error, x);
  });
  {
    const g = r.glog;
    const connRefused = g.filter((e) => e.kind === 'connect' && e.decision === 'denied' && e.host === 'b.test').length;
    check('S2.counted-cross-refusals', 'b.test CONNECT refusals logged for nav, img redirect, direct img and fetch redirect (>=4)', connRefused >= 4, connRefused);
    const chainHops = g.filter((e) => e.kind === 'request' && e.decision === 'forwarded' && /^\/chain[123]$/.test(e.path)).length;
    check('S2.chain-hops-counted', 'all 6 chain hops (nav 3 + fetch 3) individually forwarded and counted', chainHops === 6, chainHops);
    const redirectEvents = g.filter((e) => e.kind === 'redirect').length;
    check('S2.redirect-events', 'every 3xx recorded with its target host', redirectEvents >= 8, redirectEvents);
    const forbiddenPath = g.filter((e) => e.path === '/forbidden' && e.decision === 'denied' && e.reason === 'policy').length;
    check('S2.forbidden-path-denied', '/forbidden denied before upstream', forbiddenPath === 1, forbiddenPath);
    reconcile('S2', g, r.mark);
  }

  // ---------- S3 methods, HEAD, compression, CORS preflight ----------
  r = await withGuard('methods', policy(), async ({ page }) => {
    await nav(page, 'https://a.test/page');
    let x = await evalFetch(page, '/get-only', { method: 'POST', body: 'x' });
    check('S3.method-denied', 'POST to a GET-only path denied by method policy', x.status === 403 && x.deny === 'policy', x);
    x = await evalFetch(page, '/post', { method: 'POST', body: 'x' });
    check('S3.method-allowed', 'POST to an allowed POST path forwarded', x.status === 200 && x.body === 'ok-post', x);
    x = await evalFetch(page, '/ok', { method: 'HEAD' });
    check('S3.head', 'HEAD forwarded', x.status === 200, x);
    x = await evalFetch(page, '/ok', { method: 'PUT', body: 'x' });
    check('S3.put-denied', 'PUT (no rule) denied', x.status === 403 && x.deny === 'policy', x);
    const n = await nav(page, 'https://a.test/gz');
    check('S3.gzip', 'gzip response passes through and is decoded by the browser', n.status === 200 && (await page.textContent('#g')) === 'gzip-body-ok', n);
    await nav(page, 'https://a.test/page');
    x = await evalFetch(page, 'https://c.test/cors-post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    check('S3.cors-preflight', 'cross-origin POST with preflight: OPTIONS and POST both pass the boundary', x.status === 200 && x.body === 'c-ok', x);
  });
  {
    const g = r.glog;
    const opt = g.filter((e) => e.host === 'c.test' && e.method === 'OPTIONS' && e.decision === 'forwarded').length;
    check('S3.preflight-logged', 'CORS preflight logged as its own guarded request', opt === 1, opt);
    reconcile('S3', g, r.mark);
  }

  // ---------- S4 mechanisms: websocket, worker, service worker, beacon, loopback, IP literal ----------
  r = await withGuard('mechanisms', policy(), async ({ page }) => {
    await nav(page, 'https://a.test/page');
    let x = await page.evaluate(() => new Promise((res) => { const w = new WebSocket('wss://a.test/ws'); w.onopen = () => res('open'); w.onerror = () => res('error'); setTimeout(() => res('timeout'), 5000); }));
    check('S4.websocket', 'WebSocket upgrade denied', x === 'error', x);
    x = await page.evaluate(() => new Promise((res) => { const w = new WebSocket('wss://b.test/ws'); w.onopen = () => res('open'); w.onerror = () => res('error'); setTimeout(() => res('timeout'), 5000); }));
    check('S4.websocket-forbidden-host', 'WebSocket to forbidden host refused', x === 'error', x);
    await nav(page, 'https://a.test/worker-page');
    await page.waitForFunction(() => document.title.startsWith('worker-') || document.title === 'b-reached', null, { timeout: 10000 }).catch(() => {});
    x = await page.title();
    check('S4.worker', 'dedicated worker: fetch to b.test refused, allowed same-origin fetch works', x === 'worker-ok', x);
    await nav(page, 'https://a.test/page');
    x = await page.evaluate(async () => { try { await navigator.serviceWorker.register('/sw.js'); return 'resolved'; } catch (e) { return 'rejected'; } });
    await sleep(500);
    check('S4.service-worker', 'service worker blocked: /sw.js never requested', !FX.logs.a.read().some((e) => e.path === '/sw.js'), x);
    x = await page.evaluate(() => [navigator.sendBeacon('https://b.test/beacon', 'x'), navigator.sendBeacon('/beacon', 'y')]);
    await sleep(1500);
    check('S4.beacon', 'sendBeacon: forbidden host refused, allowed path forwarded', FX.logs.a.read().some((e) => e.path === '/beacon' && e.method === 'POST'), x);
    x = await evalFetch(page, `http://127.0.0.1:${FX.ports.bhttp}/direct`, { mode: 'no-cors' });
    check('S4.loopback-direct', 'page fetch to plain-HTTP loopback goes to the guard and is denied', FX.logs.bhttp.read().length === 0, x);
    x = await evalFetch(page, 'https://192.0.2.1/', { mode: 'no-cors' });
    check('S4.ip-literal', 'IP-literal HTTPS destination refused at CONNECT', !!x.error, x);
  });
  {
    const g = r.glog;
    const up = g.filter((e) => e.kind === 'upgrade' && e.decision === 'denied').length;
    check('S4.upgrade-logged', 'WebSocket upgrade denial logged', up >= 1, up);
    const ws = FX.logs.a.read().filter((e) => e.upgrade).length;
    check('S4.ws-not-forwarded', 'a.test fixture never saw an upgrade request', ws === 0, ws);
    const plain = g.filter((e) => e.reason === 'plain-http').length;
    check('S4.plain-http-logged', 'plain-HTTP proxy request denied and logged', plain >= 1, plain);
    const ip = g.filter((e) => e.kind === 'connect' && e.host === '192.0.2.1' && e.decision === 'denied').length;
    check('S4.ip-literal-logged', 'IP-literal CONNECT refusal logged', ip === 1, ip);
    reconcile('S4', g, r.mark);
  }

  // ---------- S5 caps before send, cumulative ledger, coaching cap ----------
  const capLedger = path.join(OUT, 'cap-ledger.json');
  r = await withGuard('caps-1', policy({ caps: { total: 6, navigations: 2, public: 6, coaching: 2 } }), async ({ page }) => {
    const n = [];
    for (const p of ['/nav1', '/nav2', '/nav3']) n.push(await nav(page, 'https://a.test' + p));
    check('S5.nav-cap', 'third navigation denied by navigations cap before send', n[0].status === 200 && n[1].status === 200 && n[2].status === 403 && n[2].deny === 'cap:navigations', n);
    const f = [];
    for (let i = 0; i < 6; i++) f.push(await evalFetch(page, '/ok'));
    const okN = f.filter((x) => x.status === 200).length; const capN = f.filter((x) => x.deny === 'cap:total').length;
    check('S5.total-cap', 'total cap 6: 2 navigations + 4 fetches forwarded, then denied', okN === 4 && capN === 2, f.map((x) => x.status + ':' + (x.deny || '')));
  }, capLedger);
  {
    const fxNav = fxSince(r.mark, 'a').filter((e) => /^\/nav/.test(e.path)).length;
    check('S5.nav3-not-sent', 'fixture saw exactly 2 navigations', fxNav === 2, fxNav);
    reconcile('S5a', r.glog, r.mark, ['a.test']);
    const led = JSON.parse(fs.readFileSync(capLedger, 'utf8'));
    check('S5.ledger', 'ledger records total 6, navigations 2 (reservations == fixture requests)', led.used.total === 6 && led.used.navigations === 2 && fxSince(r.mark, 'a').length === 6, led.used);
  }
  r = await withGuard('caps-2-cumulative', policy({ caps: { total: 6, navigations: 2, public: 6, coaching: 2 } }), async ({ page }) => {
    const x = await nav(page, 'https://a.test/nav4');
    check('S5.cumulative', 'a new run with the same ledger starts exhausted: first request denied', x.status === 403 && /^cap:/.test(x.deny), x);
  }, capLedger);
  check('S5.cumulative-not-sent', 'fixture saw nothing in the exhausted run', fxSince(r.mark, 'a').length === 0, fxSince(r.mark, 'a'));
  r = await withGuard('coaching-cap', policy(), async ({ page }) => {
    await nav(page, 'https://a.test/page');
    const f = [];
    for (let i = 0; i < 3; i++) f.push(await evalFetch(page, '/coach', { method: 'POST', body: '{}' }));
    check('S5.coaching-cap', 'coaching cap 2: third invocation denied before send', f[0].status === 200 && f[1].status === 200 && f[2].deny === 'cap:coaching', f);
  });
  check('S5.coaching-not-sent', 'fixture saw exactly 2 coaching POSTs', fxSince(r.mark, 'a').filter((e) => e.path === '/coach').length === 2, null);
  {
    let locked = false;
    const lf = path.join(OUT, 'lock-ledger.json');
    const h1 = await launchGuarded({ browserJson: a.browser, policy: policy(), runDir: path.join(OUT, 'runs', 'lock1'), ledgerFile: lf, logFile: path.join(OUT, 'runs', 'lock1', 'g.jsonl') });
    try { await launchGuarded({ browserJson: a.browser, policy: policy(), runDir: path.join(OUT, 'runs', 'lock2'), ledgerFile: lf, logFile: path.join(OUT, 'runs', 'lock2', 'g.jsonl') }); } catch (e) { locked = /ledger locked/.test(e.message); }
    h1.guard.cancelAll('test-end'); await h1.browser.close(); await h1.guard.close('test-end'); h1.cleanupMedia(); liveHandles.delete(h1);
    check('S5.single-run-lock', 'a second concurrent guarded run on the same ledger is refused', locked, null);
  }

  // ---------- S6 concurrency, queue limit, per-request deadline, upstream error ----------
  r = await withGuard('concurrency', policy({ maxInFlight: 2 }), async ({ page }) => {
    await nav(page, 'https://a.test/page');
    FX.logs.a.resetMax();
    const x = await page.evaluate(() => Promise.all([1, 2, 3, 4, 5].map((i) => fetch('/slow?ms=700&i=' + i).then((r) => r.status, () => 0))));
    check('S6.concurrency', 'maxInFlight 2: all 5 complete, fixture never saw more than 2 at once', x.every((s) => s === 200) && FX.logs.a.maxLive <= 2, { x, maxLive: FX.logs.a.maxLive });
  });
  check('S6.inflight-max', 'guard inFlightMax == 2', r.summary.counters.inFlightMax === 2, r.summary.counters.inFlightMax);
  reconcile('S6a', r.glog, r.mark, ['a.test']);
  r = await withGuard('queue-limit', policy({ maxInFlight: 1, queueWaitMs: 300 }), async ({ page }) => {
    await nav(page, 'https://a.test/page');
    const x = await page.evaluate(() => Promise.all([fetch('/slow?ms=1500&q=1'), fetch('/slow?ms=1500&q=2')].map((p) => p.then((r) => r.headers.get('x-ss-harness-deny') || r.status, () => 'err'))));
    check('S6.queue-wait-denied', 'second request waiting past queueWaitMs is denied, not sent', x.includes(200) && x.includes('concurrency-wait'), x);
  });
  reconcile('S6b', r.glog, r.mark, ['a.test']);
  r = await withGuard('deadline', policy({ requestTimeoutMs: 1000 }), async ({ page }) => {
    await nav(page, 'https://a.test/page');
    const x = await evalFetch(page, '/hang');
    check('S6.request-deadline', 'hanging upstream aborted at requestTimeoutMs with 504 deadline', x.status === 504 && x.deny === 'deadline', x);
    const y = await evalFetch(page, 'https://d.test/x', { mode: 'no-cors' });
    check('S6.upstream-error', 'unreachable upstream reported as upstream-error (not success)', y.error || y.status === 0 || y.status === 502, y);
  });
  {
    const dl = r.glog.find((e) => e.path === '/hang');
    check('S6.deadline-logged', 'deadline outcome logged and its reservation kept', dl && dl.outcome === 'deadline' && r.summary.ledgerUsed.total >= 2, dl);
    const ue = r.glog.find((e) => e.host === 'd.test' && e.kind === 'request');
    check('S6.upstream-error-logged', 'upstream-error logged with sent:false', ue && ue.outcome === 'upstream-error' && ue.sent === false, ue);
    reconcile('S6c', r.glog, r.mark, ['a.test']);
  }
  r = await withGuard('campaign-deadline', policy({ requestTimeoutMs: 30000, deadlineAt: new Date(Date.now() + 9000).toISOString() }), async ({ page }) => {
    await nav(page, 'https://a.test/page');
    const hang = evalFetch(page, '/hang');
    await sleep(Math.max(0, 9500 - 0));
    const okBefore = FX.logs.a.read().filter((e) => e.path === '/ok').length;
    const x = await evalFetch(page, '/ok');
    const okAfter = FX.logs.a.read().filter((e) => e.path === '/ok').length;
    check('S6.campaign-deadline', 'after the campaign deadline a new request is denied (403 or refused tunnel) and never reaches the server', (x.error || (x.status === 403 && ['closing', 'deadline-passed'].includes(x.deny))) && okAfter === okBefore, { x, okBefore, okAfter });
    await hang;
  });
  {
    const c = r.glog.find((e) => e.path === '/hang');
    check('S6.campaign-deadline-cancels', 'in-flight request at the deadline is cancelled and logged', c && c.outcome === 'cancelled' && c.reason === 'campaign-deadline', c);
    const after = r.glog.filter((e) => e.decision === 'denied' && ['closing', 'deadline-passed'].includes(e.reason)).length;
    check('S6.campaign-deadline-denial-logged', 'the post-deadline attempt is logged as a closing/deadline denial', after >= 1, after);
  }

  // ---------- S7 exact-operation one-shot faults + independent fsync-backed readback ----------
  const operationPointers = { account:'/account', take:'/take', completion:'/completion' };
  const bodyFor = label => JSON.stringify({ account:'fixture-owner', take:label, completion:'completion-' + label });
  const faultFor = (mode, label, pathname='/save') => {
    const body=bodyFor(label);
    return { id:'fixture-'+mode+'-'+label, mode,host:'a.test',method:'POST',path:'^'+pathname+'$',
      operationPointers,operationDigest:operationDigest(JSON.parse(body),operationPointers),requestBodySha256:sha256(body),
      oracleSourceId:approvedOracle.sourceId,oracleSourceSha256:approvedOracle.sha256,readbackRequestSha256:readbackRequestHash(readbackBinding) };
  };
  r = await withGuard('faults', policy(), async ({ page, guard }) => {
    await nav(page,'https://a.test/page');
    const first=faultFor('request-lost','request-lost'); guard.armFault(first);
    const before=FX.logs.a.read().filter(e=>e.path==='/save').length;
    let x=await evalFetch(page,'/save',{method:'POST',headers:{'content-type':'application/json'},body:bodyFor('request-lost')});
    const after1=FX.logs.a.read().filter(e=>e.path==='/save').length;
    check('S7.request-lost','exact request-lost gives fatal browser failure with zero server receipts',!!x.error && after1===before,{x,before,after1});
    x=await evalFetch(page,'/save',{method:'POST',headers:{'content-type':'application/json'},body:bodyFor('request-lost')});
    const after2=FX.logs.a.read().filter(e=>e.path==='/save').length;
    check('S7.request-lost-retry','one explicit retry reaches fixture once and creates exactly one durable row',x.status===200 && after2===before+1 && FX.durable.read().filter(row=>row.operationDigest===first.operationDigest).length===1,{x,after2});
    const second=faultFor('response-lost','response-lost');guard.armFault(second);
    x=await evalFetch(page,'/save',{method:'POST',headers:{'content-type':'application/json'},body:bodyFor('response-lost')});
    const after3=FX.logs.a.read().filter(e=>e.path==='/save').length;
    check('S7.response-lost','response suppressed only after separate counted GET read durable exact-operation row',!!x.error && after3===before+2 && FX.durable.read().filter(row=>row.operationDigest===second.operationDigest).length===1,{x,after3});
    x=await evalFetch(page,'/save',{method:'POST',headers:{'content-type':'application/json'},body:bodyFor('response-lost')});
    const after4=FX.logs.a.read().filter(e=>e.path==='/save').length;
    check('S7.one-shot','one explicit retry succeeds without a second durable row or silent Chromium resend',x.status===200 && after4===before+3 && FX.durable.read().filter(row=>row.operationDigest===second.operationDigest).length===1,{x,after4});
    const negative=faultFor('response-lost','negative-status','/save-error');guard.armFault(negative);
    const readsBefore=FX.logs.a.read().filter(e=>e.path==='/saved').length;
    x=await evalFetch(page,'/save-error',{method:'POST',headers:{'content-type':'application/json'},body:bodyFor('negative-status')});
    check('S7.error-status-negative','HTTP503 remains503, is never dropped or accepted as durable save, and triggers no readback',x.status===503 && FX.logs.a.read().filter(e=>e.path==='/saved').length===readsBefore && !FX.durable.read().some(row=>row.operationDigest===negative.operationDigest),x);
  });
  {
    const f=r.glog.filter(e=>e.kind==='fault');
    check('S7.fault-correlated','two successful one-shot faults log exact operation digests and a readback receipt',f.length===2 && f[0].mode==='request-lost' && f[1].mode==='response-lost' && f[1].upstreamStatus===200 && !!f[1].readbackReceiptId && f.every(e=>/^[0-9a-f]{64}$/.test(e.operationDigest)),f);
    check('S7.error-not-fired','negative fault is explicitly logged as upstream-non-success',r.glog.some(e=>e.kind==='fault-not-fired' && e.status===503 && e.reason==='upstream-non-success'),null);
    check('S7.readback-counted','one independent GET is reserved, forwarded, reconciled and separately identified',r.glog.filter(e=>e.kind==='readback-reserved').length===1 && fxSince(r.mark,'a').filter(e=>e.path==='/saved').length===1,null);
    reconcile('S7',r.glog,r.mark,['a.test']);
  }

  // ---------- S14 selected local-model download faults, separate from save faults ----------
  const modelBytes=Buffer.alloc(8192);for(let i=0;i<modelBytes.length;i++)modelBytes[i]=i%251;
  const prefixBytes=1024;
  const readDownload=(page,url)=>page.evaluate(async target=>{
    let status=null,bytes=0,error=null;const chunks=[];
    try {const response=await fetch(target,{cache:'no-store'});status=response.status;const reader=response.body.getReader();
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;chunks.push(part.value);}
    }catch(e){error=String(e);}
    const data=new Uint8Array(bytes);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
    return {status,bytes,error,sha256};
  },url);
  r=await withGuard('model-download-faults',policy(),async({page,guard})=>{
    await nav(page,'https://a.test/page');
    const modelReceipts=()=>FX.logs.a.read().filter(e=>e.path==='/model.bin' && e.method==='GET').length;
    const before=modelReceipts();
    guard.armDownloadFault({id:'fixture-model-download-fails',mode:'download-fails',url:'https://a.test/model.bin'});
    let x=await readDownload(page,'https://a.test/model.bin');await sleep(300);
    check('S14.download-fails-zero-receipts','pre-download fault produces browser failure with zero upstream receipts or silent retry',!!x.error && x.bytes===0 && modelReceipts()===before,{browser:x,serverReceipts:modelReceipts()-before});
    x=await readDownload(page,'https://a.test/model.bin');
    check('S14.download-fails-explicit-retry','one explicit Retry obtains complete expected model bytes once',!x.error && x.status===200 && x.bytes===modelBytes.length && x.sha256===sha256(modelBytes) && modelReceipts()===before+1,{browser:x,serverReceipts:modelReceipts()-before});
    guard.armDownloadFault({id:'fixture-model-offline-mid-download',mode:'offline-mid-download',url:'https://a.test/model.bin',afterBytes:prefixBytes});
    x=await readDownload(page,'https://a.test/model.bin');await sleep(300);
    check('S14.offline-prefix-and-error','exact prefix is delivered, known-length stream then fails, and browser does not silently retry',!!x.error && x.status===200 && x.bytes===prefixBytes && x.sha256===sha256(modelBytes.subarray(0,prefixBytes)) && modelReceipts()===before+2,{browser:x,serverReceipts:modelReceipts()-before});
    const offlineState=guard.summary().downloadFaults.find(f=>f.id==='fixture-model-offline-mid-download');
    check('S14.browser-offline-applied','browser context was actually set offline after the prefix',offlineState?.browserOfflineApplied===true,offlineState);
    await guard.resumeDownloadNetwork('fixture-model-offline-mid-download');
    const restoredState=guard.summary().downloadFaults.find(f=>f.id==='fixture-model-offline-mid-download');
    check('S14.network-restored','browser context is deliberately restored before the explicit Retry',restoredState?.networkRestored===true,restoredState);
    x=await readDownload(page,'https://a.test/model.bin');
    check('S14.offline-explicit-retry','one deliberate Retry obtains complete bytes without a second armed fault or extra receipt',!x.error && x.status===200 && x.bytes===modelBytes.length && x.sha256===sha256(modelBytes) && modelReceipts()===before+3,{browser:x,serverReceipts:modelReceipts()-before});
    const negativeBefore=FX.logs.a.read().filter(e=>e.path==='/model-error.bin').length;
    guard.armDownloadFault({id:'fixture-model-status-negative',mode:'offline-mid-download',url:'https://a.test/model-error.bin',afterBytes:1});
    x=await readDownload(page,'https://a.test/model-error.bin');
    check('S14.error-status-negative','HTTP 503 is delivered unchanged and cannot count as a successful model fault',!x.error && x.status===503 && x.bytes===Buffer.byteLength('intentional-download-error') && FX.logs.a.read().filter(e=>e.path==='/model-error.bin').length===negativeBefore+1,x);
  });
  {
    const faults=r.summary.downloadFaults;
    check('S14.exact-fault-summary','only exact requested modes fire with the bound prefix byte count; error-status control stays unfired',faults.length===3 && faults[0].id==='fixture-model-download-fails' && faults[0].mode==='download-fails' && faults[0].fired===true && faults[0].bytesForwarded===0 && faults[1].id==='fixture-model-offline-mid-download' && faults[1].mode==='offline-mid-download' && faults[1].fired===true && faults[1].bytesForwarded===prefixBytes && faults[1].browserOfflineApplied===true && faults[1].networkRestored===true && faults[2].id==='fixture-model-status-negative' && faults[2].fired===false && faults[2].bytesForwarded===0,faults);
    const fired=r.glog.filter(e=>e.kind==='download-fault');
    check('S14.exact-fault-log','two correlated download faults only; interrupted response records declared length and exact forwarded prefix',fired.length===2 && fired[0].decision==='not-forwarded' && fired[1].bytesForwarded===prefixBytes && fired[1].declaredLength===modelBytes.length && fired[1].browserOfflineApplied===true && fired[1].decision==='browser-offline-after-prefix' && r.glog.some(e=>e.kind==='download-network-restored' && e.faultId==='fixture-model-offline-mid-download'),fired);
    check('S14.negative-not-fired-log','503 emits explicit non-fired control log',r.glog.some(e=>e.kind==='download-fault-not-fired' && e.faultId==='fixture-model-status-negative' && e.status===503),null);
    check('S14.no-implicit-duplicates','entire guarded run has exactly three model GET receipts and one error-control receipt',fxSince(r.mark,'a').filter(e=>e.path==='/model.bin').length===3 && fxSince(r.mark,'a').filter(e=>e.path==='/model-error.bin').length===1,null);
    reconcile('S14',r.glog,r.mark,['a.test']);
  }

  // ---------- S14b compressed model download: identity encoding only for the faulted request ----------
  r=await withGuard('model-download-compressed',policy(),async({page,guard})=>{
    await nav(page,'https://a.test/page');
    const ae0=await page.evaluate(async()=>{const r=await fetch('https://a.test/model-gz.bin',{cache:'no-store'});const b=await r.arrayBuffer();return {status:r.status,seen:r.headers.get('x-ss-seen-ae'),bytes:b.byteLength};});
    check('S14b.unfaulted-keeps-encoding','a download with no armed fault still negotiates compression (no other guard rule changed)',ae0.status===200&&/gzip/.test(ae0.seen||''),ae0);
    guard.armDownloadFault({id:'fixture-model-compressed-offline',mode:'offline-mid-download',url:'https://a.test/model-gz.bin',afterBytes:prefixBytes});
    const unrelated=await page.evaluate(async()=>{const r=await fetch('https://a.test/model-gz2.bin',{cache:'no-store'});const b=await r.arrayBuffer();return {status:r.status,seen:r.headers.get('x-ss-seen-ae'),bytes:b.byteLength};});
    check('S14b.unrelated-download-still-compressed-while-armed','while the AHT-14-style fault is armed, an UNRELATED download (different URL) still negotiates compression',unrelated.status===200&&/gzip/.test(unrelated.seen||''),unrelated);
    const x=await readDownload(page,'https://a.test/model-gz.bin');await sleep(300);
    const gzState=guard.summary().downloadFaults.find(f=>f.id==='fixture-model-compressed-offline');
    check('S14b.compressed-fault-fires','identity encoding gives the faulted download a Content-Length, so the prefix fault actually fires',!!x.error && x.bytes===prefixBytes && gzState?.fired===true && gzState?.browserOfflineApplied===true,{browser:x,fault:gzState});
    await guard.resumeDownloadNetwork('fixture-model-compressed-offline');
    const after=await page.evaluate(async()=>{const r=await fetch('https://a.test/model-gz.bin',{cache:'no-store'});const b=await r.arrayBuffer();return {status:r.status,seen:r.headers.get('x-ss-seen-ae'),bytes:b.byteLength};});
    check('S14b.fault-is-single-shot','after the one armed fault, the same URL is negotiated normally again',after.status===200&&/gzip/.test(after.seen||''),after);
  });

  // ---------- S15 exact feedback transport/rejection/response-loss controls ----------
  await runFeedbackControls({withGuard,policy,FX,check,reconcile,sleep});

  // ---------- S8 upstream through an HTTPS proxy (env-proxy mode) ----------
  {
    const saved = process.env.HTTPS_PROXY; const savedNo = process.env.NO_PROXY; const savedno = process.env.no_proxy;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:' + FX.ports.fwd; process.env.NO_PROXY = ''; process.env.no_proxy = '';
    const fwdBefore = FX.logs.fwd.read().length;
    r = await withGuard('env-proxy', policy({ upstream: { mode: 'env-proxy', caFile: FX.caFile } }), async ({ page }) => {
      const x = await nav(page, 'https://a.test/page');
      check('S8.env-proxy', 'upstream via CONNECT proxy (environment HTTPS_PROXY path) works', x.status === 200, x);
    });
    const tunnels = FX.logs.fwd.read().slice(fwdBefore).map((e) => e.path);
    check('S8.env-proxy-tunnels', 'upstream proxy saw only a.test:443 tunnels', tunnels.length >= 1 && tunnels.every((t) => t === 'a.test:443'), tunnels);
    reconcile('S8', r.glog, r.mark, ['a.test']);
    process.env.HTTPS_PROXY = saved; process.env.NO_PROXY = savedNo; process.env.no_proxy = savedno;
  }

  // ---------- S9 supervisor: cancellation, deadline, parent loss, SIGKILL, step error ----------
  const stepDir = path.join(__dirname, 'steps');
  const polFile = path.join(OUT, 'policy.json'); fs.writeFileSync(polFile, JSON.stringify(policy()));
  const sup = (name, script, extra = []) => {
    const d = path.join(OUT, 'runs', 'sup-' + name);
    return { d, args: [path.join(H, 'run-guarded.cjs'), '--browser', a.browser, '--policy', polFile, '--run-dir', d, '--ledger', path.join(d, 'ledger.json'), '--script', path.join(stepDir, script), '--max-ms', '60000', '--qualification-local-only','true','--security-approval',a['security-approval'],'--step-root',__dirname,'--step-manifest',a['step-manifest'],'--step-manifest-sha256',a['step-manifest-sha256'], ...extra] };
  };
  const hangSeen = (mk) => FX.logs.a.read().slice(mk).some((e) => e.path === '/hang');
  {
    const s = sup('ok', 'ok.cjs'); const cp = runNode(s.args); const e = await waitExit(cp, 60000);
    const sum = JSON.parse(fs.readFileSync(path.join(s.d, 'summary.json'), 'utf8'));
    check('S9.ok', 'supervisor: sandbox verified, step ok, exit 0, nothing left running', e.code === 0 && sum.ownedProcessesRemaining.length === 0 && chromePids().length === 0, { e, sum: sum.reason });
    const sb = JSON.parse(fs.readFileSync(path.join(s.d, 'sandbox.json'), 'utf8'));
    check('S9.ok-sandbox-file', 'supervisor wrote its pre-step sandbox receipt', sb.sandboxReport.adequate && sb.processes.ok, sb.processes);
  }
  {
    const s = sup('sigterm', 'hang.cjs'); const mk = FX.logs.a.read().length; const cp = runNode(s.args);
    await waitFor(() => hangSeen(mk), 30000); await sleep(300);
    cp.kill('SIGTERM'); const e = await waitExit(cp, 30000);
    const sum = JSON.parse(fs.readFileSync(path.join(s.d, 'summary.json'), 'utf8'));
    const g = readJsonl(path.join(s.d, 'guard.jsonl')).find((x) => x.path === '/hang');
    check('S9.sigterm', 'SIGTERM: exit 143, in-flight request cancelled, browser closed, nothing left', e.code === 143 && g && g.outcome === 'cancelled' && sum.ownedProcessesRemaining.length === 0 && chromePids().length === 0, { e, g, rem: sum.ownedProcessesRemaining });
  }
  {
    const s = sup('deadline', 'hang.cjs'); s.args[s.args.indexOf('--max-ms') + 1] = '6000';
    const cp = runNode(s.args); const e = await waitExit(cp, 30000);
    const sum = JSON.parse(fs.readFileSync(path.join(s.d, 'summary.json'), 'utf8'));
    check('S9.deadline', 'step deadline: exit 4, cancelled, nothing left', e.code === 4 && sum.reason === 'deadline' && sum.ownedProcessesRemaining.length === 0 && chromePids().length === 0, { e, reason: sum.reason });
  }
  {
    const s = sup('parent-lost', 'hang.cjs'); const mk = FX.logs.a.read().length;
    const sh = spawn(process.execPath, ['-e', "const child=require('node:child_process').spawn(process.execPath,JSON.parse(process.argv[1]),{stdio:'ignore'});process.stdout.write(String(child.pid));setInterval(()=>{},1000);", JSON.stringify(s.args)], { stdio: ['ignore', 'pipe', 'ignore'] }); ownedChildren.add(sh); sh.once('exit',()=>ownedChildren.delete(sh));
    let supPid = 0; sh.stdout.on('data', (d) => { supPid = supPid || Number(String(d).trim()); });
    await waitFor(() => hangSeen(mk), 30000); await sleep(300);
    sh.kill('SIGKILL');
    await waitFor(() => { try { process.kill(supPid, 0); return false; } catch { return true; } }, 30000);
    const sum = JSON.parse(fs.readFileSync(path.join(s.d, 'summary.json'), 'utf8'));
    await waitFor(() => chromePids().length === 0, 5000);
    check('S9.parent-lost', 'parent killed: supervisor detects it, cancels, exits 5, nothing left', sum.reason === 'parent-lost' && sum.exitCode === 5 && sum.ownedProcessesRemaining.length === 0 && chromePids().length === 0, { reason: sum.reason, code: sum.exitCode });
  }
  {
    const s = sup('sigkill', 'hang.cjs'); const mk = FX.logs.a.read().length; const cp = runNode(s.args);
    await waitFor(() => hangSeen(mk), 30000); await sleep(300);
    const before = chromePids().length;
    cp.kill('SIGKILL'); await waitExit(cp, 10000);
    const gone = await waitFor(() => chromePids().length === 0, 10000);
    const led = JSON.parse(fs.readFileSync(path.join(s.d, 'ledger.json'), 'utf8'));
    check('S9.sigkill', 'supervisor SIGKILLed: its Chromium exits (pipe closed) within 10 s; reservations already on disk', before > 0 && gone && led.used.total >= 2, { before, gone, used: led.used });
  }
  {
    const s = sup('throws', 'throws.cjs'); const cp = runNode(s.args); const e = await waitExit(cp, 60000);
    const sum = JSON.parse(fs.readFileSync(path.join(s.d, 'summary.json'), 'utf8'));
    check('S9.step-error', 'step throws: exit 1 reported as step-error, nothing left', e.code === 1 && sum.reason === 'step-error' && sum.ownedProcessesRemaining.length === 0 && chromePids().length === 0, { e, reason: sum.reason });
  }

  // ---------- S9a per-case request allowance: the REAL supervisor, case recorder and Chromium (loopback only) ----------
  // Exhaust the allowance deliberately, then verify: the supervisor stops the case (exit 6) and cleans up, nothing is forwarded beyond the allowance, genuine results recorded
  // BEFORE the refusal stay, checks recorded AFTER it are NOT RUN, and the next-case gate (real boundary + real campaign core) continues only after verified cleanup.
  {
    const core = require(path.join(H, 'campaign-core.cjs')), runnerMod = require(path.join(H, 'campaign-runner.cjs'));
    const QREQ = ['pre-pass', 'pre-upstream-failure', 'pre-genuine-fail', 'post-save-denied', 'post-coach-denied', 'post-pass', 'post-fail'];
    const dummyEnv = { ...process.env, THROWAWAY_TEST_EMAIL: 'qualification-dummy@invalid.example', THROWAWAY_TEST_PASSWORD: 'qualification-dummy-not-a-credential' };
    const mkCase = (name, scenario, allowance) => {
      const s0 = sup('allow-' + name, 'allowance-case.cjs'); fs.mkdirSync(s0.d, { recursive: true, mode: 0o700 });
      const cfgFile = path.join(s0.d, 'case-config.json');
      const cfg = { caseId: 'AHT-12', campaignId: 'QUAL-ALLOWANCE', sourceSha: FIXTURE_SOURCE_SHA, servedSha: FIXTURE_SOURCE_SHA, targetUrl: 'https://speaksharp-public.vercel.app', requiredAssertions: QREQ, credentialVars: { email: 'THROWAWAY_TEST_EMAIL', password: 'THROWAWAY_TEST_PASSWORD' }, startPressCap: 0, takeCap: 0, qualificationScenario: scenario };
      const bytes = Buffer.from(JSON.stringify(cfg)); fs.writeFileSync(cfgFile, bytes, { mode: 0o600 });
      s0.args.push('--case-config', cfgFile, '--case-config-sha256', sha256(bytes), '--campaign-id', 'QUAL-ALLOWANCE', '--case-request-allowance', String(allowance));
      return s0;
    };
    const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const N = 9;
    // ---- exhaust ----
    {
      const s0 = mkCase('exhaust', 'exhaust', N); const mk = FX.logs.a.read().length; const cp = runNode(s0.args, { env: dummyEnv }); const e = await waitExit(cp, 90000);
      const sumF = path.join(s0.d, 'summary.json'), resF = path.join(s0.d, 'case-result.json');
      const sum = fs.existsSync(sumF) ? rd(sumF) : null, res = fs.existsSync(resF) ? rd(resF) : null, glog = readJsonl(path.join(s0.d, 'guard.jsonl'));
      check('S9a.exit-code', 'allowance exhaustion stops the case through the supervisor: exit 6, reason allowance-exhausted', e.code === 6 && sum && sum.reason === 'allowance-exhausted' && sum.exitCode === 6, { e, reason: sum && sum.reason, code: sum && sum.exitCode });
      check('S9a.cleanup', 'bounded cleanup completed: no owned process left, no stop/launch/media cleanup failure, no Chromium running', !!sum && sum.ownedProcessesRemaining.length === 0 && !sum.stopError && !sum.launchCleanupFailure && !sum.mediaCleanupFailure && chromePids().length === 0, { rem: sum && sum.ownedProcessesRemaining, stopError: sum && sum.stopError, chrome: chromePids().length });
      const ca = sum && sum.guard && sum.guard.caseAllowance;
      check('S9a.allowance-state', `guard summary: allowance ${N}, used ${N}, exhausted`, !!ca && ca.allowance === N && ca.used === N && ca.exhausted === true, ca);
      check('S9a.signal-once', 'guard logged the allowance signal exactly once and refused with cap:case-allowance', glog.filter((x) => x.kind === 'allowance-exhausted').length === 1 && glog.filter((x) => x.decision === 'denied' && x.reason === 'cap:case-allowance').length >= 1, { signals: glog.filter((x) => x.kind === 'allowance-exhausted').length, denied: glog.filter((x) => x.reason === 'cap:case-allowance').length });
      const fxA = FX.logs.a.read().slice(mk);
      check('S9a.nothing-beyond-allowance', `the fixture saw exactly ${N} requests (never more), and no refused /save or /coach reached it`, fxA.length === N && !fxA.some((x) => x.path === '/coach' || x.path === '/save') && forwardedTo(glog, 'a.test').length === N, { fixture: fxA.length, forwarded: forwardedTo(glog, 'a.test').length });
      const rows = new Map(((res && res.assertions) || []).map((x) => [x.id, x]));
      check('S9a.prior-fails-remain', 'genuine FAILs recorded BEFORE the refusal remain FAIL (upstream 503 and product-style FAIL), PASS remains PASS, none marked interrupted', rows.get('pre-pass') && rows.get('pre-pass').result === 'PASS' && ['pre-upstream-failure', 'pre-genuine-fail'].every((id) => rows.get(id) && rows.get(id).result === 'FAIL' && rows.get(id).interruptedBy === undefined), [...rows.values()].map((x) => x.id + ':' + x.result));
      check('S9a.affected-not-run', 'checks recorded AFTER the refusal (denied save, denied coaching, a PASS) are NOT RUN with the observed result kept as a closed field', ['post-save-denied', 'post-coach-denied', 'post-pass'].every((id) => rows.get(id) && rows.get(id).result === 'NOT RUN' && rows.get(id).interruptedBy === 'request-allowance' && ['FAIL', 'PASS'].includes(rows.get(id).observedResult)) && rows.get('post-save-denied').observedResult === 'FAIL' && rows.get('post-pass').observedResult === 'PASS', [...rows.values()].map((x) => x.id + ':' + x.result + ':' + (x.interruptedBy || '')));
      check('S9a.case-result', 'case result stays FAIL (genuine pre-refusal failures) and carries the interruption record', !!res && res.result === 'FAIL' && res.interruption && res.interruption.kind === 'request-allowance' && res.interruption.affectedChecks === 3, res && { result: res.result, interruption: res.interruption });
      // ---- next-case gate with the real boundary and the real campaign core ----
      const cmd = { status: e.code, cleanupIncomplete: false };
      const boundary = runnerMod.evaluateCaseBoundary(res || { assertions: [] }, sum, cmd);
      check('S9a.boundary', 'real case boundary: allowance exhausted, cleanup verified, not a safety stop, no cap denial', boundary.allowanceExhausted === true && boundary.allowanceCleanupVerified === true && boundary.safetyStop === false && boundary.capDenials.length === 0, { ex: boundary.allowanceExhausted, ok: boundary.allowanceCleanupVerified, stop: boundary.safetyStop, caps: boundary.capDenials });
      const hash = 'a'.repeat(64), commit = 'b'.repeat(40), t0 = Date.parse('2026-10-27T12:00:00Z');
      const plan = { version: 1, campaignId: 'QUAL-GATE-NOT-A-RUN', runtime: 'Claude SpeakSharp R4', targetUrl: 'https://speaksharp-public.vercel.app/', costCeilingUsd: 0, sourceSha: commit, servedSha: commit, admissionConfigFile: 'q.json', admissionConfigSha256: hash, stepRoot: 'q', stepManifestFile: 's.json', stepManifestSha256: hash, campaignLedger: 'l.json', identityLedger: 'i.json', identityCap: 32, runRoot: 'q', deadlineAt: '2026-10-27T13:00:00Z', cleanupReserveMs: 1000, cases: core.IDS.map((id) => ({ id, driverFile: id + '.cjs', driverSha256: hash, configFile: id + '.json', configSha256: hash, maxMs: 100 })) };
      const gate = async (sumUsed, cmdUsed) => {
        const b = runnerMod.evaluateCaseBoundary(res, sumUsed, cmdUsed); const calls = [];
        const io = { now: () => t0, save: async () => {}, preflightCase: async () => {}, admit: async () => ({ result: 'ADMISSION PASS' }), identity: async () => ({ result: 'MATCH', servedSha: commit }), caseConfig: async (c) => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: 'https://speaksharp-public.vercel.app/', requiredAssertions: ['pre-pass', 'pre-upstream-failure', 'pre-genuine-fail', 'post-save-denied', 'post-coach-denied', 'post-pass', 'post-fail'] }), runCase: async (c) => { calls.push(c.id); return c.id === 'AHT-01' ? { ...b, assertions: res.assertions, reason: b.reason } : { assertions: [{ id: 'pre-pass', result: 'PASS', detail: 'gate fixture', evidenceRefs: ['q.json'] }] }; } };
        const r = await core.runCampaign(plan, io, { executeR0: true }); return { calls, row: r.report.cases[0], stopped: r.report.safetyStopped };
      };
      const ok = await gate(sum, cmd);
      check('S9a.gate-continues', 'next-case gate: after the verified stop the campaign CONTINUES to all later cases; the interrupted case keeps FAIL and is marked as a request-allowance interruption', ok.calls.length === 15 && ok.row.allowanceExhausted === true && ok.row.interruption === 'request-allowance' && ok.row.result === 'FAIL' && ok.stopped === false, { calls: ok.calls.length, row: { ex: ok.row.allowanceExhausted, i: ok.row.interruption, r: ok.row.result }, stopped: ok.stopped });
      const tampered = { 'owned process remains': [{ ...sum, ownedProcessesRemaining: [{ pid: 1, name: 'chrome' }] }, cmd], 'stop error': [{ ...sum, stopError: 'OWNED_CLEANUP_FAILED', exitCode: 3 }, { ...cmd, status: 3 }], 'runner cleanup incomplete': [sum, { ...cmd, cleanupIncomplete: true }], 'media cleanup failure': [{ ...sum, mediaCleanupFailure: true, exitCode: 3 }, { ...cmd, status: 3 }] };
      const stops = {}; for (const [name, [s2, c2]] of Object.entries(tampered)) { const g = await gate(s2, c2); stops[name] = g.calls.length === 1 && g.stopped === true; }
      check('S9a.gate-stops-on-cleanup-failure', 'next-case gate: an unverified cleanup (owned process left, stop error, runner cleanup flag, media cleanup failure) stops the campaign before any later case', Object.values(stops).every(Boolean), stops);
    }
    // ---- control: same genuine results, allowance not reached ----
    {
      const s0 = mkCase('control', 'control', 500); const cp = runNode(s0.args, { env: dummyEnv }); const e = await waitExit(cp, 90000);
      const sum = fs.existsSync(path.join(s0.d, 'summary.json')) ? rd(path.join(s0.d, 'summary.json')) : null, res = fs.existsSync(path.join(s0.d, 'case-result.json')) ? rd(path.join(s0.d, 'case-result.json')) : null, glog = readJsonl(path.join(s0.d, 'guard.jsonl'));
      const rows = new Map(((res && res.assertions) || []).map((x) => [x.id, x]));
      check('S9a.control', 'control: allowance not reached - exit 0, no interruption, the same FAILs stay genuine FAIL (never reclassified), no allowance signal', e.code === 0 && !!sum && sum.reason === 'completed' && !!res && res.result === 'FAIL' && res.interruption === undefined && ['pre-upstream-failure', 'pre-genuine-fail', 'post-fail'].every((id) => rows.get(id) && rows.get(id).result === 'FAIL' && rows.get(id).interruptedBy === undefined) && glog.filter((x) => x.kind === 'allowance-exhausted').length === 0 && chromePids().length === 0, { e, reason: sum && sum.reason, result: res && res.result });
      const b = runnerMod.evaluateCaseBoundary(res || { assertions: [] }, sum, { status: e.code, cleanupIncomplete: false });
      check('S9a.control-boundary', 'control boundary: not an allowance exhaustion, no safety stop', b.allowanceExhausted === false && b.allowanceCleanupVerified === false && b.safetyStop === false, b);
    }
  }

  // ---------- S12 fake microphone: deny, then allow, with the reviewed WAV ----------
  {
    const wav = path.join(OUT, 'tone.wav');
    { const sr = 16000, n = sr; const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2); fs.writeFileSync(wav, b, {mode:0o600}); }
    const dir = path.join(OUT, 'runs', 'media'); const mark = fxMark();
    const originalMediaHash=sha256(fs.readFileSync(wav));
    const mediaBefore = new Set(fs.readdirSync(a['private-media-parent']));
    const h = await launchGuarded({ browserJson: a.browser, policy: policy(), runDir: dir, ledgerFile: path.join(dir, 'ledger.json'), logFile: path.join(dir, 'guard.jsonl'), media: { file: wav,sha256:sha256(fs.readFileSync(wav)) } });
    const mediaCreated=fs.readdirSync(a['private-media-parent']).filter(name=>!mediaBefore.has(name) && name.startsWith('media-private-'));
    check('S12.media-private-owner','exactly one private 65534 directory0700/file0600 was created',mediaCreated.length===1 && mediaCreated.every(name=>{const d=fs.statSync(path.join(a['private-media-parent'],name)),f=fs.statSync(path.join(a['private-media-parent'],name,'capture.wav'));return d.uid===65534 && d.gid===65534 && (d.mode&0o777)===0o700 && f.uid===65534 && f.gid===65534 && (f.mode&0o777)===0o600;}),{createdCount:mediaCreated.length});
    const page = await h.context.newPage();
    await nav(page, 'https://a.test/page');
    const gum = () => page.evaluate(async () => { const to = new Promise((r) => setTimeout(() => r({ ok: false, name: 'timeout-pending' }), 8000)); return Promise.race([to, (async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(s).connect(an); await new Promise((r) => setTimeout(r, 700)); const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); const peak = Math.max(...d.map(Math.abs)); s.getTracks().forEach((t) => t.stop()); return { ok: true, peak }; } catch (e) { return { ok: false, name: e.name }; } })()]); });
    const denied = await gum();
    check('S12.mic-deny', 'without a granted permission getUserMedia fails with NotAllowedError', !denied.ok && denied.name === 'NotAllowedError', denied);
    await h.context.grantPermissions(['microphone'], { origin: 'https://a.test' });
    const allowed = await gum();
    check('S12.mic-allow', 'after granting, the fake device delivers the reviewed WAV signal', allowed.ok && allowed.peak > 0.05, allowed);
    h.guard.cancelAll('test-end'); await h.browser.close(); await h.guard.close('test-end'); h.cleanupMedia(); liveHandles.delete(h);
    check('S12.media-success-cleanup','successful browser close removes only generated private media nodes',mediaCreated.every(name=>!fs.existsSync(path.join(a['private-media-parent'],name))) && fs.existsSync(wav) && sha256(fs.readFileSync(wav))===originalMediaHash,null);
    check('S12.media-hash-logged', 'the WAV content hash is recorded in the guard log', readJsonl(path.join(dir, 'guard.jsonl')).some((e) => e.kind === 'media' && /^[0-9a-f]{64}$/.test(e.sha256)), null);
    reconcile('S12', readJsonl(path.join(dir, 'guard.jsonl')), mark, ['a.test']);
    // Failure/deadline/cancellation exercise the production launch/supervisor cleanup code.
    const mediaNames=()=>fs.readdirSync(a['private-media-parent']).filter(n=>n.startsWith('media-private-')).sort();
    const beforeFailure=mediaNames();
    const badBrowser=path.join(OUT,'browser-intentional-missing-executable.json');
    fs.writeFileSync(badBrowser,JSON.stringify({...browserInfo,wrapperPath:path.join(OUT,'intentionally-nonexistent-browser')}));
    let failureObserved=false; let failureReason=null;
    try { await launchGuarded({browserJson:badBrowser,policy:policy(),runDir:path.join(OUT,'runs','media-launch-failure'),ledgerFile:path.join(OUT,'runs','media-launch-failure','ledger.json'),logFile:path.join(OUT,'runs','media-launch-failure','guard.jsonl'),media:{file:wav,sha256:sha256(fs.readFileSync(wav))}}); } catch(error) { failureObserved=true;failureReason=String(error.message); }
    const failureLog=readJsonl(path.join(OUT,'runs','media-launch-failure','guard.jsonl'));
    const failureReachedMedia=failureLog.some(e=>e.kind==='media' && e.sha256===originalMediaHash);
    check('S12.media-launch-failure-cleanup','post-media browser launch failure removes generated private media and preserves source',failureObserved && failureReachedMedia && /intentionally-nonexistent-browser/.test(failureReason) && JSON.stringify(beforeFailure)===JSON.stringify(mediaNames()) && sha256(fs.readFileSync(wav))===originalMediaHash && chromePids().length===0,{failureObserved,failureReachedMedia});
    for(const reason of ['deadline','sigterm']) {
      const beforeRun=mediaNames();
      const step=sup('media-'+reason,'hang.cjs',['--media-file',wav,'--media-sha256',sha256(fs.readFileSync(wav)),'--private-media-parent',a['private-media-parent']]);
      if(reason==='deadline') step.args[step.args.indexOf('--max-ms')+1]='6000';
      const mark=FX.logs.a.read().length, child=runNode(step.args);
      if(reason==='sigterm') { const observed=await waitFor(()=>hangSeen(mark),30000); if(!observed) throw new Error('media SIGTERM fixture never reached in-flight request'); child.kill('SIGTERM'); }
      const exit=await waitExit(child,35000);
      const summary=JSON.parse(fs.readFileSync(path.join(step.d,'summary.json'),'utf8'));
      check('S12.media-'+reason+'-cleanup','private media removed on '+reason+' with no owned Chromium left',exit.code===(reason==='deadline'?4:143) && summary.ownedProcessesRemaining.length===0 && chromePids().length===0 && JSON.stringify(beforeRun)===JSON.stringify(mediaNames()) && sha256(fs.readFileSync(wav))===originalMediaHash && readJsonl(path.join(step.d,'guard.jsonl')).some(e=>e.kind==='media' && e.sha256===originalMediaHash),{exit,reason:summary.reason,sourceUnchanged:sha256(fs.readFileSync(wav))===originalMediaHash});
    }

  }

  // ---------- S10 Lighthouse through the same boundary ----------
  if (lighthouseSelection==='required') {
    const d = path.join(OUT, 'runs', 'lighthouse'); const mk = fxMark();
    const lp = path.join(OUT, 'lh-policy.json'); fs.writeFileSync(lp, JSON.stringify(policy()));
    const cp = runNode([path.join(H, 'lighthouse-run.cjs'), '--browser', a.browser, '--policy', lp, '--run-dir', d, '--ledger', path.join(d, 'ledger.json'), '--lighthouse-cli', a['lighthouse-cli'], '--url', 'https://a.test/img-page', '--max-ms', '180000', '--qualification-local-only','true','--security-approval',a['security-approval'],'--lighthouse-cli-sha256',a['lighthouse-cli-sha256']]);
    const e = await waitExit(cp, 200000);
    let sum = { privilege: { ok: false, samples: 0 }, ownedProcessesRemaining: ['summary missing'] };
    try { sum = JSON.parse(fs.readFileSync(path.join(d, 'summary.json'), 'utf8')); } catch {}
    let lhr = null; try { lhr = JSON.parse(fs.readFileSync(path.join(d, 'lhr.json'), 'utf8')); } catch {}
    check('S10.lighthouse', 'Lighthouse completes via CHROME_PATH wrapper through the guard', e.code === 0 && lhr && lhr.finalDisplayedUrl === 'https://a.test/img-page' && !lhr.runtimeError, { e, err: lhr && lhr.runtimeError, url: lhr && lhr.finalDisplayedUrl });
    check('S10.lighthouse-privilege', 'all sampled Lighthouse Chrome processes uid/gid 65534, no caps, no sandbox-weakening flags', sum.privilege.ok && sum.privilege.samples > 0, sum.privilege);
    check('S10.lighthouse-cleanup', 'no Lighthouse Chrome left running', sum.ownedProcessesRemaining.length === 0 && chromePids().length === 0, sum.ownedProcessesRemaining);
    reconcile('S10', readJsonl(path.join(d, 'guard.jsonl')), mk, ['a.test']);
  } else {for(const id of LIGHTHOUSE_IDS){results.push({id,desc:'Lighthouse-only qualification not selected by final owner scope',ok:null,result:'NOT_RUN',reason:'OWNER_NOT_SELECTED'});console.log('NOT_RUN '+id+' OWNER_NOT_SELECTED');}}

  check('S11.final-no-leak', 'across the whole self-test b.test and plain-HTTP loopback fixtures received zero requests', FX.logs.b.read().length === 0 && FX.logs.bhttp.read().length === 0, { b: FX.logs.b.read().length, bhttp: FX.logs.bhttp.read().length });
  check('S11.final-no-chrome', 'no harness Chromium left running at the end', chromePids().length === 0, chromePids());
  const shutdown = await closeOwned('qualification-completed');
  check('S11.fixtures-stopped','all owned fixture listeners stopped before qualification verdict',shutdown.fixturesClosed && shutdown.cleanupErrors.length===0,shutdown);
  check('S11.final-owned-processes','owned children reaped before qualification verdict',shutdown.ownedProcessesRemaining.length===0,shutdown.ownedProcessesRemaining);
  const reviewed = verifyReviewedStep({ ...reviewOptions, stepFile:path.join(__dirname,'durable-oracle.cjs') });
  check('S13.native-node-scope-review','external named hash-bound trusted-code review supplied; this is NOT a native Node sandbox',reviewed.verified && reviewed.networkIsolation==='NOT_PROVIDED',{reviewer:reviewed.reviewer,manifestSha256:reviewed.manifestSha256});
  const finalIntegrity=require(path.join(H,'preflight.cjs')).verifyManifest(path.resolve(H,'..'),'CODE.sha256');
  check('S13.final-code-integrity','qualified source bytes still match reviewed CODE manifest at completion',finalIntegrity.result==='PASS',finalIntegrity);
  const failed = results.filter((x) => x.ok===false);
  const verdict=summarizeQualification(results,lighthouseSelection);
  fs.writeFileSync(path.join(OUT, 'selftest-results.json'), JSON.stringify({ when: new Date().toISOString(), env, ...verdict, results }, null, 2) + '\n');
  const summaryFile=path.join(OUT,'selftest-results.json');
  const controls={feedbackOperationFaults:['S15.'],cumulativeCapsLedgerAndLocks:['S5.'],environmentProxyDns:['S8.'],sandboxProcesses:['S1.'],defaultDenyAllBrowserMechanisms:['S2.','S3.','S4.','S11.final-no-leak'],independentFixtureReconciliation:['.reconcile.','.no-leak','S7.readback-counted'],redirectChains:['S2.'],nativeNodeScopeReview:['S13.'],modelDownloadFaults:['S14.'],durableOperationFaults:['S7.'],errorStatusNegativeControl:['S7.error'],privateMediaLifecycle:['S12.'],deadlinesCancellationAndCleanup:['S6.','S9.','S11.final-no-chrome','S11.fixtures-stopped','S11.final-owned-processes']};
  const checks={};
  for(const [name,patterns] of Object.entries(controls)) {
    const matching=results.filter(r=>!r.id.startsWith('S10.')&&patterns.some(p=>r.id.includes(p)));
    const evidence=path.join(OUT,'control-'+name+'.json');fs.writeFileSync(evidence,JSON.stringify({sourceSummarySha256:sha256(fs.readFileSync(summaryFile)),results:matching},null,2)+'\n',{mode:0o600});
    checks[name]={result:matching.length && matching.every(r=>r.ok)?'PASS':'FAIL',evidenceSha256:sha256(fs.readFileSync(evidence)),evidencePath:path.basename(evidence)};
  }
  const lighthouseEvidence=path.join(OUT,'control-lighthouse.json');fs.writeFileSync(lighthouseEvidence,JSON.stringify({sourceSummarySha256:sha256(fs.readFileSync(summaryFile)),selection:lighthouseSelection,ownerApprovalReference:capabilityApproval.ownerApprovalReference,results:results.filter(r=>r.id.startsWith('S10.'))},null,2)+'\n',{mode:0o600});
  const capabilities={lighthouse:{...capabilityApproval,result:verdict.lighthouseResult,...(lighthouseSelection==='not-selected'?{reason:'OWNER_NOT_SELECTED'}:{}),evidenceSha256:sha256(fs.readFileSync(lighthouseEvidence)),evidencePath:path.basename(lighthouseEvidence)}};
  const receipt={...verdict,capabilities,lighthouseCliSha256:lighthouseSelection==='required'?a['lighthouse-cli-sha256']:null,runtime:'Claude SpeakSharp R4',node:process.version.slice(1),playwright:installedPlaywright,chromiumRevision:installedChromiumRevision,codeManifestSha256:sha256(fs.readFileSync(path.join(H,'..','CODE.sha256'))),checks,scope:'approved-loopback-fixtures-only',productTraffic:false,summarySha256:sha256(fs.readFileSync(summaryFile)),startedAt:QUAL_STARTED_AT,endedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(OUT,'qualification-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log(`SELFTEST ${verdict.result}: ${verdict.passed} PASS / ${verdict.failed} FAIL / ${verdict.notRun} NOT_RUN; scope=${verdict.qualifiedScope}`);
  clearTimeout(qualificationTimer); clearInterval(parentWatch);
  process.exit(verdict.result==='PASS'?0:1);
})().catch(e => stopQualification('qualification-error',2,e));
