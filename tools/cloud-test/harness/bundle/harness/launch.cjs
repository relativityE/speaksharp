'use strict';
// launch.cjs: start the guard proxy, then the sandboxed unprivileged Chromium whose only route out is
// that proxy. Node-side Playwright networking (route.fetch, context.request, page.request) is disabled
// because it would bypass the browser's proxy; faults are armed on the guard instead.
const fs = require('fs');
const path = require('path');
const { startGuard } = require('./guard-proxy.cjs');
const { assertSecurityApproval } = require('./approval-gate.cjs');
const { createPrivateMedia } = require('./media-private.cjs');

const {FORBIDDEN_FLAGS,guardFlags:browserFlags,childEnvironment}=require('./launch-boundary.cjs');
const {ownedLaunch}=require('./launch-ownership.cjs');
const {BrowserPrefix,attachPage:attachPrefixPage}=require('./browser-prefix.cjs');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// Fake microphone input for recorded takes: the reviewed WAV is copied (by content hash) into a
// 65534-readable folder and fed through Chromium's fake capture device. These are the only extra
// browser flags the harness accepts. Microphone permission stays a per-context decision
// (context.grantPermissions(['microphone']) to allow; not granting it makes getUserMedia fail with
// NotAllowedError in headless), so deny-then-allow cases need no other flag.
function mediaFlags(media, runDir, browserUid, privateMediaParent) {
  if (!media) return null;
  const options={sourceFile:media.file,runDir,expectedSha256:media.sha256};
  if(browserUid !== process.getuid()) Object.assign(options,{targetUid:browserUid,targetGid:browserUid,approvedPrivateParent:privateMediaParent});
  const prepared=createPrivateMedia(options);
  return { ...prepared, flags:['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${prepared.path}`] };
}

function disableNodeSideNetwork(obj, label) {
  // page.request is the same object as context.request, so patching it once covers both.
  if (obj.request && !obj.request.__ssDisabled) {
    for (const m of ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head']) obj.request[m] = async () => { throw new Error(`${label}.request.${m} is disabled: Node-side requests bypass the guard`); };
    obj.request.__ssDisabled = true;
  }
  for (const k of ['route', 'routeFromHAR', 'routeWebSocket']) obj[k] = () => { throw new Error(`${label}.${k} is disabled in the guarded lane; arm faults on the guard`); };
}

// opts: { browserJson, policy (object), runDir, ledgerFile, logFile, headless=true, contextOptions }
// Playwright 1.57 already supplies these exact guard flags once; its ignoreDefaultArgs filter would also strip user args, so they are not repeated.
const PLAYWRIGHT_DEFAULT_GUARD_FLAGS=['--disable-background-networking','--disable-component-update','--disable-sync'];
async function launchGuarded(opts) {
  assertSecurityApproval(opts, opts.policy);
  const co = { ...(opts.contextOptions || {}) };
  if ('proxy' in co || co.ignoreHTTPSErrors === true) throw new Error('context proxy/certificate override is not allowed');
  const pwPath = require.resolve('playwright', { paths: [process.cwd()] });
  const { chromium } = require(pwPath);
  const b = readJson(opts.browserJson);
  const owned=await ownedLaunch({signal:opts.signal,
    prepareMedia:()=>opts.media ? mediaFlags(opts.media,opts.runDir,b.runAsUid,opts.privateMediaParent):null,
    createGuard:()=>startGuard(opts.policy,{signal:opts.signal,runDir:opts.runDir,ledgerFile:opts.ledgerFile,logFile:opts.logFile,securityApprovalFile:opts.securityApprovalFile,readbackOracle:opts.readbackOracle,expectedLedgerIdentity:opts.expectedLedgerIdentity,reserveTake:opts.reserveTake,caseRequestAllowance:opts.caseRequestAllowance,onAllowanceExhausted:opts.onAllowanceExhausted,onFatal:opts.onFatal}),
    createBrowser:async(guard,media)=>{
      if(media)guard.log({kind:'media',sha256:media.sha256});
      return chromium.launch({env:childEnvironment({node:process.execPath,bundleRoot:path.resolve(__dirname,'..'),approvalFile:path.resolve(opts.securityApprovalFile),port:guard.port,spki:guard.spki}),executablePath:b.wrapperPath,chromiumSandbox:true,
        headless:opts.headless!==false,args:browserFlags(guard.port,guard.spki).filter(f=>!PLAYWRIGHT_DEFAULT_GUARD_FLAGS.includes(f)).concat(media?media.flags:[]),downloadsPath:b.downloadsPath,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,timeout:30000});
    },
    createContext:async(browser,guard)=>{
      const prefix=opts.downloadPrefixObservation===true?new BrowserPrefix({journal:event=>guard.durableLog(event)}):null;
      if(prefix)guard.browserPrefixObserver=prefix;
      const newContext=browser.newContext.bind(browser);
      browser.newContext=async(o={})=>{
        if('proxy' in o||o.ignoreHTTPSErrors===true)throw new Error('context proxy/certificate override is not allowed');
        const c=await newContext({...o,serviceWorkers:'block'});disableNodeSideNetwork(c,'context');c.on('page',p=>disableNodeSideNetwork(p,'page'));
        if(prefix){const makePage=c.newPage.bind(c);c.newPage=async()=>{const page=await makePage();try{await attachPrefixPage(c,page,prefix);return page;}catch(error){await page.close().catch(()=>{});throw error;}};}
        return c;
      };
      browser.newPage=async()=>{throw new Error('use the guarded context');};
      const context=await browser.newContext(co);guard.offlineControl=value=>context.setOffline(value);return context;
    }
  });
  return {...owned,browserInfo:b,media:owned.media&&{sha256:owned.media.sha256},cleanupMedia:()=>owned.media&&owned.media.cleanup()};
}

// Every live descendant of this process: uid/gid/groups/capabilities/seccomp and forbidden flags.
const HOST_USERNS = (() => { try { return fs.readlinkSync('/proc/self/ns/user'); } catch { return null; } })();
function inspectDescendants(rootPid = process.pid) {
  const kids = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(d));
    } catch {}
  }
  const out = []; const stack = [...(kids.get(rootPid) || [])];
  while (stack.length) {
    const pid = stack.pop();
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const f = (k) => (status.match(new RegExp('^' + k + ':[ \\t]*(.*)$', 'm')) || [])[1] || '';
      let userns = null; try { userns = fs.readlinkSync(`/proc/${pid}/ns/user`); } catch {}
      let argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      // Chromium child processes rewrite their command line into one space-separated string.
      if (argv.length === 1 && /\s--/.test(argv[0])) argv = argv[0].split(/\s+/).filter(Boolean);
      out.push({ pid, name: f('Name'), uid: f('Uid').split(/\s+/).map(Number), gid: f('Gid').split(/\s+/).map(Number), groups: f('Groups').trim(), capEff: f('CapEff'), capPrm: f('CapPrm'), capBnd: f('CapBnd'), seccomp: Number(f('Seccomp')), userns, initUserns: userns === HOST_USERNS, noNewPrivs: Number(f('NoNewPrivs')), type: ((argv.find((a) => a.startsWith('--type=')) || '').slice(7)) || 'browser', forbiddenFlags: argv.filter((a) => FORBIDDEN_FLAGS.includes(a.split('=')[0])), isChrome: /chrome/.test(argv[0] || '') });
    } catch {}
    stack.push(...(kids.get(pid) || []));
  }
  return out;
}

function checkSandboxedProcesses(procs) {
  const chrome = procs.filter((p) => p.isChrome);
  const problems = [];
  if (!chrome.length) problems.push('no chrome processes found');
  for (const p of chrome) {
    if (!p.uid.every((u) => u === 65534)) problems.push(`pid ${p.pid} uid ${p.uid.join('/')}`);
    if (!p.gid.every((g) => g === 65534)) problems.push(`pid ${p.pid} gid ${p.gid.join('/')}`);
    if (p.groups !== '') problems.push(`pid ${p.pid} supplementary groups ${p.groups}`);
    // Capabilities count only in the host user namespace. Chromium's sandbox layer creates its own
    // user namespace (owned by 65534) where its broker holds namespace-local capabilities; those
    // grant nothing on the host and are recorded, not failed.
    if (p.initUserns && (!/^0+$/.test(p.capEff) || !/^0+$/.test(p.capPrm))) problems.push(`pid ${p.pid} host-namespace capabilities eff ${p.capEff} prm ${p.capPrm}`);
    if (!p.initUserns && !p.userns) problems.push(`pid ${p.pid} user namespace unreadable`);
    // The browser process (launched through the wrapper) must carry none of the forbidden flags.
    // Child processes get their command lines from Chromium itself: --no-sandbox or --single-process
    // there is a failure; other per-type launch flags (e.g. Chromium starting its GPU/utility
    // processes outside the zygote with --no-zygote-sandbox, which then apply their own seccomp
    // policy) are recorded, not failed.
    const fatal = p.type === 'browser' ? p.forbiddenFlags : p.forbiddenFlags.filter((f) => f === '--no-sandbox' || f === '--single-process');
    if (fatal.length) problems.push(`pid ${p.pid} (${p.type}) forbidden flags ${fatal.join(',')}`);
  }
  const childFlagNotes = {}; for (const p of chrome) if (p.type !== 'browser') for (const f of p.forbiddenFlags) { const k = p.type + ' ' + f + ' seccomp=' + p.seccomp + (p.initUserns ? ' host-userns' : ' chromium-userns'); childFlagNotes[k] = (childFlagNotes[k] || 0) + 1; }
  return { childFlagNotes, browserProcesses: chrome.filter((p) => p.type === 'browser').length, chromeProcesses: chrome.length, inHostUserns: chrome.filter((p) => p.initUserns).length, inChromiumUserns: chrome.filter((p) => !p.initUserns).length, renderers: chrome.filter((p) => p.type === 'renderer').length, renderersWithSeccomp: chrome.filter((p) => p.type === 'renderer' && p.seccomp === 2).length, byType: chrome.reduce((m, p) => ((m[p.type] = (m[p.type] || 0) + 1), m), {}), seccompByType: chrome.reduce((m, p) => { const k = p.type + ' seccomp=' + p.seccomp + (p.initUserns ? ' host-userns' : ' chromium-userns'); m[k] = (m[k] || 0) + 1; return m; }, {}), problems, ok: problems.length === 0 };
}

// Chromium's own sandbox report. chrome:// pages do not use the network.
async function sandboxReport(context) {
  const p = await context.newPage();
  try {
    await p.goto('chrome://sandbox', { timeout: 15000 });
    const text = await p.locator('body').innerText();
    return { adequate: /You are adequately sandboxed/i.test(text), namespace: /PID namespaces\s*Yes/i.test(text) && /Network namespaces\s*Yes/i.test(text), seccomp: /Seccomp-BPF sandbox\s*Yes/i.test(text), text: text.replace(/\s+/g, ' ').slice(0, 600) };
  } finally { await p.close(); }
}

module.exports = { launchGuarded, browserFlags, inspectDescendants, checkSandboxedProcesses, sandboxReport, FORBIDDEN_FLAGS };
