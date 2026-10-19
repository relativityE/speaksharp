// Read-only exact-source adverse-oracle probes. Real jsdom MutationObserver; synthetic network scheduler.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const head = 'a81fbb97850749596f6fbfba006895fc56c65b26';
const hashes = {};
const read = path => {
  const source = execFileSync('git', ['show', head + ':' + path], { encoding: 'utf8' });
  hashes[path] = createHash('sha256').update(source).digest('hex');
  return source;
};
const spec = read('tests/live/rwt-adverse-mic-model.live.spec.ts');
const helper = read('tests/live/helpers/rwtAdverse.ts');
const abandon = read('tests/live/helpers/rwtAbandonTakeover.ts');
const transpile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(transpile(helper), { module, exports: module.exports });
const verdict = statuses => module.exports.downloadFailureVerdict({ exercised: true, statuses, finalStatus: 'error', retryOffered: true, mode: 'private' });
const armSource = spec.slice(spec.indexOf('async function armModelStatusLog('), spec.indexOf('const modelStatuses ='));
assert(armSource.startsWith('async function armModelStatusLog('));
const drain = () => new Promise(resolve => setImmediate(resolve));
const checks = [];
async function statusTrace(name, states, pauseBetween, useLossless) {
  const dom = new JSDOM('<!doctype html><html data-model-status="loading"></html>');
  const globals = { window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver };
  if (useLossless) {
    const helperModule = { exports: {} };
    vm.runInNewContext(transpile(abandon), { ...globals, module: helperModule, exports: helperModule.exports });
    helperModule.exports.installModelStatusHistory();
  } else {
    vm.runInNewContext(transpile(armSource) + '\nthis.arm = armModelStatusLog;', globals);
    await globals.arm({ evaluate: fn => fn() });
  }
  for (const state of states) {
    dom.window.document.documentElement.setAttribute('data-model-status', state);
    if (pauseBetween) await drain();
  }
  await drain();
  const observed = Array.from(useLossless ? dom.window.__rwtModelStatusHistory__ : dom.window.__rwtModelStatuses__);
  const result = verdict(observed);
  dom.window.close();
  return { name, published: ['loading', ...states], observed, verdict: result.status };
}
const honest = await statusTrace('honest failure', ['error'], false, false);
assert.equal(honest.verdict, 'PASS'); checks.push(honest);
const separatelyDelivered = await statusTrace('ready delivered in distinct observer callback', ['ready', 'error'], true, false);
assert.equal(separatelyDelivered.verdict, 'FAIL'); checks.push(separatelyDelivered);
const coalesced = await statusTrace('ready then error before observer delivery', ['ready', 'error'], false, false);
assert.deepEqual(coalesced.observed, ['loading', 'error']);
assert.equal(coalesced.verdict, 'PASS'); checks.push(coalesced);
const lossless = await statusTrace('existing case11 oldValue observer on same mutations', ['ready', 'error'], false, true);
assert(lossless.observed.includes('ready'));
assert.equal(lossless.verdict, 'FAIL'); checks.push(lossless);

// Run the actual listener + injection block with deterministic callback delivery. Not a browser-network frequency claim.
const begin = spec.indexOf('const modelFailures = { afterFault: 0 };');
const end = spec.indexOf('await failedState(page, 300_000);', begin);
const block = spec.slice(begin, end);
assert(block.includes('await context.setOffline(true);\n                faultOn = true;'));
const runInjection = new Function('context', 'page', 'expect', 'watch', 'variant', 'MODEL_PATH', 'MODEL_ASSETS',
  'return (async()=>{' + transpile(block) + '\nreturn modelFailures.afterFault;})();');
async function injection(delivery, url = 'https://local.invalid/models/whisper-base.en/onnx/decoder_model_merged_quantized.onnx') {
  const handlers = {};
  let emitAfter = false;
  const emit = () => handlers.requestfailed?.({ url: () => url });
  const context = {
    on: (name, handler) => { handlers[name] = handler; },
    route: async () => {},
    setOffline: async () => {
      if (delivery === 'during-await') emit();
      else if (delivery === 'after-await') emitAfter = true;
    }
  };
  const page = { getByTestId: () => ({ click: async () => { handlers.request?.({ url: () => url }); } }) };
  const expect = { poll: () => ({ toBeGreaterThan: async () => {} }) };
  const count = await runInjection(context, page, expect, { setFaultPhase() {} }, 'offline-mid-download', /\/models\//, '**/models/**');
  // The block returns before this synthetic later callback, so retain a separate direct listener variant below.
  return { count, emitAfter };
}
const during = await injection('during-await');
assert.equal(during.count, 0);
const duringVerdict = module.exports.downloadFailureVerdict({ exercised: during.count > 0, statuses: ['loading', 'error'], finalStatus: 'error', retryOffered: true, mode: 'private' }).status;
assert.equal(duringVerdict, 'HOLD');
checks.push({ name: 'requestfailed delivered during awaited offline call', counter: during.count, verdict: duringVerdict,
  limit: 'Actual listener/injection source with a synthetic scheduler. No claim that Playwright always uses this order or that it caused the historical run.' });
const syntheticPositiveBlock = block + '\ncontext.deliverAfter?.();';
const runAfter = new Function('context', 'page', 'expect', 'watch', 'variant', 'MODEL_PATH', 'MODEL_ASSETS',
  'return (async()=>{' + transpile(syntheticPositiveBlock) + '\nreturn modelFailures.afterFault;})();');
async function countedAfter(url) {
  const handlers = {};
  const context = { on: (name, handler) => { handlers[name] = handler; }, route: async()=>{}, setOffline: async()=>{},
    deliverAfter: () => handlers.requestfailed({ url: () => url }) };
  return runAfter(context, { getByTestId: () => ({ click: async()=>{} }) }, { poll: () => ({ toBeGreaterThan: async()=>{} }) },
    { setFaultPhase(){} }, 'offline-mid-download', /\/models\//, '**/models/**');
}
assert.equal(await countedAfter('https://local.invalid/models/whisper-base.en/onnx/decoder_model_merged_quantized.onnx'), 1);
checks.push({ name: 'same failed weight request after offline await is counted', count: 1 });
assert.equal(await countedAfter('https://local.invalid/not-a-model'), 0);
checks.push({ name: 'non-model URL excluded', count: 0 });
assert.equal(await countedAfter('https://local.invalid/models/other-model/config.json'), 1);
checks.push({ name: 'unrelated model config under prefix also counts', count: 1,
  limit: 'Prefix/phase count does not prove exact selected weight/attempt/injected-fault identity; Sam already tracks this binding gap.' });
const output = { observedAtUtc: new Date().toISOString(), sourceHead: head, hashes, checks, assertions: checks.length,
  newLiveRuns: 0, providerCalls: 0, accountOperations: 0,
  finding: 'Adverse logger drops intermediate published model ready state in one MutationObserver delivery; actual never-ready oracle returns PASS. Offline injected-fault count also has callback ordering sensitivity.' };
writeFileSync(new URL('adverse-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));

