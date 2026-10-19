// Offline source-contract probes only. Synthetic in-memory data; no hosted database or provider.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const head = 'ba1a9f5ad31778460a4ea9e383a08be14b3222f6';
const hashes = {};
const read = (p) => {
  const text = execFileSync('git', ['show', `${head}:${p}`], { encoding: 'utf8' });
  hashes[p] = createHash('sha256').update(text).digest('hex'); return text;
};
const gateSource = read('frontend/src/services/telemetry/completenessGate.ts');
const gateModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(gateSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: gateModule, exports: gateModule.exports, console,
  require: (name) => {
    if (name.endsWith('telemetryAllowlist')) return { GOVERNED_EVENTS: [] };
    if (name.endsWith('AnalyticsBuffer')) return { attemptedEventFamilies: () => [] };
    if (name.endsWith('deliveryReceiptGate')) return { EXACTLY_ONCE_RECEIPT_FAMILIES: [] };
    if (name.endsWith('outcomeCorrelation')) return { correlateFeedbackAttempts() {}, correlatePracticePresses() {} };
    throw new Error(`Unexpected dependency ${name}`);
  },
});
const gate = gateModule.exports;
const declared = ['session_during', 'session_interrupted_repeat', 'practice_again'];
const interrupted = gate.QUALIFICATION_STAGES.find(s => s.stage === 'session_interrupted_repeat');
const globalRequired = [...gate.requiredFamiliesForStages(declared)];
if (interrupted.requiredFamilies.includes('practice_loop') || !globalRequired.includes('practice_loop')) throw new Error('gate conflict did not reproduce');

const sql = read('backend/supabase/migrations/20260810120000_retention_purge_ai_suggestions.sql');
const db = new PGlite();
let before, after;
try {
  await db.exec(`CREATE TABLE public.sessions(id uuid primary key,transcript text,transcript_state text,ai_suggestions jsonb,total_words int);
    INSERT INTO public.sessions VALUES
    ('11111111-1111-4111-8111-111111111111','synthetic A','available','{"what_worked":"synthetic A good","what_to_try_next":"synthetic A next"}',10),
    ('22222222-2222-4222-8222-222222222222','synthetic B','available','{"what_worked":"synthetic B good","what_to_try_next":"synthetic B next"}',20);`);
  await db.exec(sql);
  before = (await db.query('SELECT id,ai_suggestions IS NOT NULL AS pair_present FROM public.sessions ORDER BY id')).rows;
  // This is an explicit expiry input, not an execution of the whole hosted newest-one expiry chain.
  await db.exec("UPDATE public.sessions SET transcript=NULL,transcript_state='expired' WHERE id='11111111-1111-4111-8111-111111111111';");
  after = (await db.query('SELECT id,transcript_state,ai_suggestions IS NOT NULL AS pair_present FROM public.sessions ORDER BY id')).rows;
  if (!before.every(r => r.pair_present) || after[0].pair_present || !after[1].pair_present) throw new Error('retention purge did not reproduce');
} finally { await db.close(); }
const consistency = read('tests/live/helpers/rwtCoachingConsistency.ts');
const fn = consistency.match(/export function takesDifferVerdict\([\s\S]*?\n\}/)[0];
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fn, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: mod, exports: mod.exports });
const compareAfterExpiry = mod.exports.takesDifferVerdict(null, { well: 'synthetic B good', next: 'synthetic B next' }, true);
if (compareAfterExpiry.status !== 'HOLD') throw new Error('pair comparison expected HOLD');
const output = {
  sourceHead: head, sourceSha256: hashes,
  gateConflict: { declared, stageRequiresPracticeLoop: interrupted.requiredFamilies.includes('practice_loop'), globalRequiresPracticeLoop: globalRequired.includes('practice_loop'), globalRequired,
    result: 'CONFIRMED_SOURCE_CONTRACT_CONFLICT', limit: 'No predicate is relaxed here; other interrupted-repeat identity/lifecycle invariants still must qualify.' },
  retentionPairConflict: { before, after, actualComparison: compareAfterExpiry, result: 'CONFIRMED_VALID_EXPIRY_CAN_CAUSE_PAIR_HOLD',
    limit: 'Actual purge migration on a minimal synthetic PGlite table with explicit expiry input; not full retention selection, hosted state or proof of which historical pair was missing.' },
  controls: { interruptedStageVersusGlobalGate: 'PASS', bothPairsBeforeExpiry: 'PASS', actualExpiryTriggerPurgesDerivedPair: 'PASS', postExpiryComparisonHolds: 'PASS' },
  liveRuns: 0, providerCalls: 0, hostedDbOperations: 0,
};
writeFileSync(new URL('source-probe-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
