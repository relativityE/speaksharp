// Evidence-only actual-helper controls. No live browser/provider/account operation.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const head = 'a81fbb97850749596f6fbfba006895fc56c65b26';
const hashes = {};
function read(path) {
  const source = execFileSync('git', ['show', `${head}:${path}`], { encoding: 'utf8' });
  hashes[path] = createHash('sha256').update(source).digest('hex');
  return source;
}
const source = read('tests/live/helpers/rwtAbandonTakeover.ts');
const spec = read('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports });
const { modelWorkBeforeRefusal, secondTabBlockedVerdict } = module.exports;
const liveA = { runtimeState: 'RECORDING', recorderVisible: true, liveTracks: 1 };
const quietB = { runtimeState: 'IDLE', recorderVisible: false, liveTracks: 0 };
const cleanModel = { cold: true, modelRequests: 0, statusHistory: [], statusAtRefusal: 'download-required' };
function verdict(model = cleanModel, tabB = quietB, tabA = liveA, refusal = true) {
  return secondTabBlockedVerdict({ refusalCopyShown: refusal && !modelWorkBeforeRefusal(model), tabB, tabA }).status;
}
const results = [];
function control(name, expected, execute, limit) {
  const actual = execute();
  assert.equal(actual, expected, name);
  results.push({ name, expected, actual, assertion: 'PASS', ...(limit ? { interpretation: limit } : {}) });
}
control('clean cold refusal with A live', 'PASS', () => verdict());
control('model request before refusal rejects', 'FAIL', () => verdict({ ...cleanModel, modelRequests: 1 }));
control('transient model work retained before refusal rejects', 'FAIL', () => verdict({ ...cleanModel, statusHistory: ['loading', 'download-required'] }));
control('live microphone on B at endpoint rejects', 'FAIL', () => verdict(cleanModel, { ...quietB, liveTracks: 1 }));
control('A stopped at endpoint rejects', 'FAIL', () => verdict(cleanModel, quietB, quietB));
control('missing refusal rejects', 'FAIL', () => verdict(cleanModel, quietB, liveA, false));

// Replay precisely the immutable snapshots in the actual spec. This models observations, not product behavior.
const modelRequestsSnapshot = spec.indexOf('const modelRequestsBeforeRefusal = modelRequestsB;');
const statusSnapshot = spec.indexOf('const statusHistoryB = await deviceB.evaluate(');
const decision = spec.indexOf('const leaseRefusal = refusedInTime && !modelWorkFirst;');
const hold = spec.indexOf('await deviceB.waitForTimeout(2_000);', decision);
const states = spec.indexOf('const [refusedB, stillA2]', hold);
const row = spec.indexOf("receipt.row('another device is refused by the account lease'", states);
assert(modelRequestsSnapshot < statusSnapshot && statusSnapshot < decision && decision < hold && hold < states && states < row);
control('forbidden model work during post-refusal hold escapes frozen snapshots', 'PASS', () => {
  let requestCount = 0;
  const history = [];
  const snapshot = { cold: true, modelRequests: requestCount, statusHistory: history.slice(), statusAtRefusal: 'download-required' };
  const frozenRefusal = !modelWorkBeforeRefusal(snapshot);
  requestCount++;
  history.push('loading', 'download-required');
  assert.equal(modelWorkBeforeRefusal({ ...snapshot, modelRequests: requestCount, statusHistory: history }), true);
  return secondTabBlockedVerdict({ refusalCopyShown: frozenRefusal, tabB: quietB, tabA: liveA }).status;
}, 'Confirmed oracle counterexample: model activity after the snapshot but before takeover is not consumed by this row. Not a claim that the product does it.');
control('transient B microphone acquisition ending before endpoint escapes endpoint predicate', 'PASS', () => {
  const callsBefore = 0;
  const callsAfter = 1;
  assert(callsAfter > callsBefore);
  return verdict(cleanModel, quietB);
}, 'Actual predicate consumes current liveTracks/runtime/visibility, not any-acquisition history. No historical product acquisition is asserted.');
control('transient A interruption ending before endpoint escapes endpoint predicate', 'PASS', () => {
  const trace = ['RECORDING', 'IDLE', 'RECORDING'];
  assert(trace.includes('IDLE'));
  return verdict(cleanModel, quietB, liveA);
}, 'Current endpoint state alone does not establish A remained recording for the entire refusal window.');

const navStart = spec.indexOf("if (variant === 'navigate-away')");
const returnedProducts = spec.indexOf("await openProductsItem(page, 'open-mic')", navStart);
const escape = spec.indexOf("await page.keyboard.press('Escape');", navStart);
const absent = spec.indexOf("await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0, { timeout: 10_000 });", escape);
assert(navStart >= 0 && escape > navStart && absent > escape && absent < returnedProducts);
assert(spec.includes('const leftTakeOnce = leftTakeSavedOnce(rowsBeforeFirst, rowsAtReturn);'));
assert(spec.includes("receipt.row('leaving mid-recording releases the microphone'"));
results.push({ name: 'case9 source wiring: Escape and modal absence before return Products; saved-once and microphone assertions retained', assertion: 'PASS', interpretation: 'Source inspection only; no rendered-app or live acceptance claimed.' });
const output = { observedAtUtc: new Date().toISOString(), sourceHead: head, hashes, controls: results,
  assertions: results.length, newLiveRuns: 0, providerCalls: 0, accountOperations: 0,
  disposition: 'Case9 bounded source correction credited; case11 full-window evidence remains open. This strengthens Sam existing acceptance gap, not a new historical cause.' };
writeFileSync(new URL('probe-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
