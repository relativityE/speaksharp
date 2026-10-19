// Read-only exact-source DocumentProvenance regression controls; no browser/network/live operation.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const oldHead = '45c579099c86c38a91d1df811856e822e9cdde97';
const newHead = '401da0f3e3d13795f2b8acaf36ce7bcc45eb65fa';
const path = 'tests/live/helpers/rwtDocumentIdentity.ts';
const hashes = {};
function load(head) {
  const source = execFileSync('git', ['show', head + ':' + path], { encoding: 'utf8' });
  hashes[head] = createHash('sha256').update(source).digest('hex');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, require, Buffer, URL });
  return module.exports;
}
const wall = 1_790_000_000_000;
const url = 'https://us.i.posthog.com/i/v0/e/';
const body = Buffer.from('fixed-content-free-test-batch');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup(head) {
  const api = load(head);
  const cdp = new EventEmitter();
  let release, reject;
  cdp.send = async method => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'L1' } } };
    if (method === 'Network.getRequestPostData') return new Promise((ok, bad) => { release = ok; reject = bad; });
    return {};
  };
  const page = new EventEmitter();
  page.isClosed = () => false;
  await api.trackDocuments(page, cdp);
  cdp.emit('Page.lifecycleEvent', { frameId: 'main', loaderId: 'L2', name: 'init', timestamp: 5000 });
  cdp.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'L2' } });
  const tracker = api.documentTrackerOf(page);
  return { cdp, page, tracker, release: () => release({ postData: body.toString('base64'), base64Encoded: true }), reject: () => reject(new Error('unavailable')) };
}
function send(s, inline = false) {
  s.cdp.emit('Network.requestWillBeSent', { requestId: 'sent', loaderId: 'L2', timestamp: 5000.002, wallTime: wall / 1000 + 0.002,
    request: { url, method: 'POST', hasPostData: true, ...(inline ? { postDataEntries: [{ bytes: body.toString('base64') }] } : {}) } });
}
function clock(s, delta) {
  s.cdp.emit('Network.requestWillBeSent', { requestId: 'other', loaderId: 'L2', timestamp: 5000.004, wallTime: wall / 1000 + 0.004 + delta / 1000,
    request: { url: 'https://local.invalid/other.js', method: 'GET' } });
}
const controls = [];
for (const [head, expectedDelta] of [[oldHead,20],[newHead,0]]) {
  const s = await setup(head);
  const ref = s.tracker.refFor(url, body);
  send(s);
  clock(s,20);
  s.release(); await flush();
  assert(ref.resolved && !ref.ambiguous && !ref.replaced);
  assert.equal(Math.round(ref.committedAt - wall), expectedDelta);
  controls.push({ name: head === oldHead ? 'parent reproduces moved document start' : 'successor preserves request-time mapping', head, documentStartDeltaMs: Math.round(ref.committedAt-wall),
    captureAtMs: 3, captureBeforeComputedStart: wall + 3 < ref.committedAt });
}
for (const delta of [-20,0,100]) {
  const s = await setup(newHead);
  const ref = s.tracker.refFor(url, body);
  send(s); clock(s,delta); s.release(); await flush();
  assert.equal(Math.round(ref.committedAt - wall),0);
  controls.push({ name: 'pending body preserves start across later mapping delta', deltaMs: delta, result: 'PASS' });
}
{
  const s = await setup(newHead); const ref = s.tracker.refFor(url,body);
  send(s,true); clock(s,20); await flush();
  assert.equal(Math.round(ref.committedAt-wall),0);
  controls.push({ name:'inline body remains stable after later clock sample', result:'PASS' });
}
{
  const s = await setup(newHead); const ref = s.tracker.refFor(url,body);
  send(s); s.cdp.emit('Page.lifecycleEvent',{frameId:'main',loaderId:'L3',name:'init',timestamp:5000.1});
  s.cdp.emit('Page.frameNavigated',{frame:{id:'main',loaderId:'L3'}}); clock(s,20); s.release(); await flush();
  assert(ref.resolved && !ref.replaced); assert.equal(Math.round(ref.committedAt-wall),0);
  controls.push({ name:'body delay across navigation retains sending-time origin and mapping', result:'PASS' });
}
{
  const s=await setup(newHead); const ref=s.tracker.refFor(url,body);
  send(s); s.reject(); await flush();
  assert(!ref.resolved); assert.equal(s.tracker.unattributed,1);
  controls.push({name:'body retrieval failure remains unattributed',result:'PASS'});
}
{
  const s=await setup(newHead); const first=s.tracker.refFor(url,body);
  send(s,true); const duplicate=s.tracker.refFor(url,body); await flush();
  assert(!first.resolved && !duplicate.resolved); assert.equal(s.tracker.conflicts,1);
  controls.push({name:'duplicate candidate still invalidates provenance',result:'PASS'});
}
{
  const s=await setup(newHead); s.cdp.emit('Inspector.detached',{});
  assert.equal(s.tracker.proven,false);
  controls.push({name:'notified source loss without queued events remains unproven',result:'PASS'});
}
const output={observedAtUtc:new Date().toISOString(),oldHead,newHead,sourcePath:path,hashes,groupedControls:controls.length,controls,
  scope:'Actual provenance module with deterministic fake CDP/Page emitters; not full watchdog integration, complete test suite, browser clock-frequency evidence, CI or live qualification.',
  disposition:'Bounded request-time offset correction passes. Whole PR remains subject to current Sam disposition and outstanding blind-beacon/adverse/window evidence.'};
writeFileSync(new URL('results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output));

