import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOURCE_CONTRACTS,SOURCE_CONSUMER,SOURCE_ASSERTION,inspectSourceContract,sourceContractBinding,
  consumeSourceContracts,validateSourceContractWitness} from '../../scripts/lib/sourceContractEvidence.mjs';
import {executionRoute} from '../../scripts/lib/testExecutionEvidence.mjs';
const {test}=process.env.NODE_TEST_CONTEXT?await import('node:test'):await import('vitest');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const canary=`import {collectCanaryStopSave,isOwnedStopSettledInPage,startOwnerId} from './canaryStopSaveOracle';
const savedId = startOutcome.sessionId;
const outcome = await collectCanaryStopSave(page, {
sessionId: savedId,
waitForSettledTake: () => page.waitForFunction(isOwnedStopSettledInPage, savedId, { timeout: remainingMs() }),
reloadSavedTake: () => page.reload({ timeout: remainingMs() })
}); const route = \`/progress/\${savedId}\`.replace(/\\/$/, ''); expect(outcome.kind).toBe('saved');`;
const filler=`import {corpusRows,crossCheckCounts,fillerAnnotationsOf,hesitationTotals} from './helpers/rwtFillerReference';
hesitationTotals(transcript, corpus);
for(const row of corpusRows(corpus, transcript, fillerAnnotationsOf(fixture.entry), fixture.entry.kind)) receipt.row('reference', row.verdict, row.detail, {});
for(const [key,c] of Object.entries(crossCheckCounts(transcript, productFillerCount))) receipt.row(key,c.verdict,{});
humanObservation(receipt, 'open_mic_uh_detected', 'human');
const returned = await back.click({ timeout: 20_000 }).then(() => page.waitForURL((url) => url.pathname === '/progress', { timeout: 30_000 }));`;
// #1548 route contracts (#1724), as each spec carries them.
const products=`const arrived = clicked && await page.waitForURL((url) => url.pathname === '/progress', { timeout: 30_000 }).then(() => true).catch(() => false);`;
const recording=`await page.goto(\`/analytics/\${persistedId}\`);
await expect(page).toHaveURL((url) => url.pathname === \`/progress/\${persistedId}\`, { timeout: 45_000 });`;
const pageContext=`expect(analytics.metadata.canonicalRoute).toBe('/progress');
expect(owned.metadata.canonicalRoute).toBe('/progress/:sessionId');
expect(owned.page_url).toBe('/progress/:sessionId');`;
const ROUTES=[[SOURCE_CONTRACTS[3],products,1],[SOURCE_CONTRACTS[4],recording,2],[SOURCE_CONTRACTS[5],pageContext,3]];

test('canary source rejects a negated saved matcher on the actual outcome',()=>{
  const negated=canary.replace("expect(outcome.kind).toBe('saved')","expect(outcome.kind, diagnostic).not.toBe('saved')");
  assert.notEqual(negated,canary);
  assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[0],negated),/Source wiring contract failed/);
});

test('canary source rejects disconnected outcome and saved matcher calls',()=>{
  const disconnected=canary.replace("expect(outcome.kind).toBe('saved')","expect(outcome.kind, diagnostic); expect(unrelated).toBe('saved')");
  assert.notEqual(disconnected,canary);
  assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[0],disconnected),/Source wiring contract failed/);
});

test('saved matcher must assert the owned collector result in the same statement scope',()=>{
  const moved=canary.replace("expect(outcome.kind).toBe('saved')","function unused() { expect(outcome.kind).toBe('saved'); }");
  assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[0],moved),/Source wiring contract failed/);
  assert.equal(inspectSourceContract(root,SOURCE_CONTRACTS[0],canary.replace('expect(outcome.kind)','expect(outcome.kind, diagnostic)')).savedMatcher.expected,'saved');
});

test('source contracts reject missing wires and comments posing as execution',()=>{
  for(const [file,source] of [[SOURCE_CONTRACTS[0],canary],[SOURCE_CONTRACTS[1],filler]]) {
    const proof=inspectSourceContract(root,file,source);
    assert.equal(proof.liveExecution,'NOT RUN');assert.equal(proof.detectedFaults,file===SOURCE_CONTRACTS[0]?7:7);
    assert.throws(()=>inspectSourceContract(root,file,`/* ${source} */`),/wiring contract failed/);
  }
  for(const [from,to] of [['sessionId: savedId','sessionId: foreignId'],['await collectCanaryStopSave','collectCanaryStopSave'],
    ['reloadSavedTake:','missingReload:'],['expect(outcome.kind','expect(unrelated.kind'],
    ["'./canaryStopSaveOracle'","'./fakeOracle'"],[".toBe('saved')",".toBe('anything')"]]) {
    assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[0],canary.replace(from,to)),/wiring contract failed/);
  }
  for(const [from,to] of [['row.verdict',"'PASS'"],['c.verdict',"'PASS'"],['crossCheckCounts','ignoredCounter'],['humanObservation','ignoredObservation']]) {
    assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[1],filler.replace(from,to)),/wiring contract failed/);
  }
  assert.throws(()=>inspectSourceContract(root,'tests/live/unregistered.live.spec.ts',canary),/Unregistered/);
});

test('route contracts accept exactly their canonical /progress wires, with no live credit',()=>{
  for(const [file,source,wires] of ROUTES) {
    const proof=inspectSourceContract(root,file,source);
    assert.equal(proof.liveExecution,'NOT RUN');assert.equal(proof.kind,'wiring-contract');
    assert.equal(proof.checks,wires);assert.equal(proof.detectedFaults,wires);
    assert.throws(()=>inspectSourceContract(root,file,`/* ${source} */`),/wiring contract failed/);
    assert.throws(()=>inspectSourceContract(root,file,`${source}\n${source}`),/wiring contract failed/,'a duplicated wire is not unique');
  }
});

test('route contracts refuse the legacy /analytics destination and near-miss paths',()=>{
  for(const [from,to] of [["url.pathname === '/progress'","url.pathname === '/analytics'"],["=== '/progress'","=== '/progressx'"],
    ["=== '/progress'","!== '/progress'"],['{ timeout: 30_000 }','{ timeout: 1 }']]) {
    assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[3],products.replace(from,to)),/wiring contract failed/);
    assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[1],filler.replace(from,to)),/wiring contract failed/);
  }
  for(const [from,to] of [['`/progress/${persistedId}`','`/analytics/${persistedId}`'],['`/progress/${persistedId}`','`/progress/${otherId}`'],
    ['await page.goto(`/analytics/${persistedId}`);','await page.goto(`/progress/${persistedId}`);'],['toHaveURL','not.toHaveURL']]) {
    assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[4],recording.replace(from,to)),/wiring contract failed/);
  }
  for(const [from,to] of [["toBe('/progress');","toBe('/analytics');"],["canonicalRoute).toBe('/progress/:sessionId')","canonicalRoute).toBe('/analytics/:sessionId')"],
    ["page_url).toBe('/progress/:sessionId')","page_url).toBe('/progress')"],['expect(owned.page_url)','expect(other.page_url)']]) {
    assert.throws(()=>inspectSourceContract(root,SOURCE_CONTRACTS[5],pageContext.replace(from,to)),/wiring contract failed/);
  }
});

test('route specs without their wires are not applicable; with them, applicability still grants no credit',()=>fixture(({dir,write})=>{
  for(const [file,source] of ROUTES) {
    write(file,'import {test} from "@playwright/test"; test("baseline",async()=>{});\n');
    assert.equal(executionRoute(file,dir).applicable,false);
    write(file,source);
    const route=executionRoute(file,dir);
    assert.equal(route.applicable,true);assert.equal(route.liveExecution,'NOT RUN');
    write(file,source.replace('/progress','/analytics'));
    assert.equal(executionRoute(file,dir).applicable,false);
  }
}));

function fixture(check) {
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'source-contract-control-')));
  const write=(file,source)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),source);};
  try {
    write('package.json','{}');fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
    for(const file of [SOURCE_CONSUMER,'scripts/lib/sourceContractEvidence.mjs']) write(file,fs.readFileSync(path.join(root,file)));
    write(SOURCE_CONTRACTS[0],canary);write(SOURCE_CONTRACTS[1],filler);
    check({dir,write});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('baseline specs and unannotated fixture keep explicit refusal rather than a live or Vitest fallback',()=>fixture(({dir,write})=>{
  for(const file of SOURCE_CONTRACTS) {
    write(file,file.endsWith('.json')?JSON.stringify({fixtures:{open_mic_tts:{kind:'synthetic',groundTruthFillers:{um:4,uh:3,'you know':1}}}})
      :'import {test} from "@playwright/test"; test("baseline",async()=>{});\n');
    const route=executionRoute(file,dir);
    assert.equal(route.runner,'vitest-source-contract');assert.equal(route.applicable,false);
    assert.equal(route.liveExecution,'NOT RUN');assert.ok(route.unavailableReason);
  }
}));

test('applicability never grants semantic credit and renamed imports remain unavailable',()=>fixture(({dir,write})=>{
  const file=SOURCE_CONTRACTS[0];
  assert.equal(executionRoute(file,dir).applicable,true);
  write(file,canary.replace(".toBe('saved')",".not.toBe('saved')"));
  assert.equal(executionRoute(file,dir).applicable,true,'known shape still needs the fault-sensitive consumer');
  assert.throws(()=>consumeSourceContracts(dir,{phaseId:'semantic-fault',cwd:dir,testFile:path.join(dir,SOURCE_CONSUMER),
    sourceContract:{files:[file],sourceBinding:sourceContractBinding(dir,[file])}}),/wiring contract failed/);
  write(file,canary.replace('collectCanaryStopSave,','collectCanaryStopSave as renamedCollector,'));
  assert.equal(executionRoute(file,dir).applicable,false);
  write(file,canary.replace('import {','import type {'));
  assert.equal(executionRoute(file,dir).applicable,false);
  write(file,canary);fs.unlinkSync(path.join(dir,SOURCE_CONSUMER));
  assert.equal(executionRoute(file,dir).applicable,false);
}));

test('source witness refuses stale bytes, missing consumer, wrong phase and fake live credit',()=>fixture(({dir,write})=>{
  const binding={phaseId:'independent-phase',cwd:dir,testFile:path.join(dir,SOURCE_CONSUMER),
    sourceContract:{files:[SOURCE_CONTRACTS[0]],sourceBinding:sourceContractBinding(dir,[SOURCE_CONTRACTS[0]]),
      witnessFile:path.join(dir,'.source-contract-independent-phase.json')}};
  const raw=consumeSourceContracts(dir,binding);
  const report={testResults:[{assertionResults:[{fullName:SOURCE_ASSERTION,status:'passed'}]}]};
  const envelope={finished:{files:[{tasks:[{type:'test',name:SOURCE_ASSERTION,result:{state:'pass'}}]}]}};
  assert.deepEqual(validateSourceContractWitness(raw,binding,dir,report,envelope),[SOURCE_CONTRACTS[0]]);
  for(const change of [r=>{r.liveExecution='EXECUTED';},r=>{r.phaseId='other';},r=>{r.proofs[0].sha256='0'.repeat(64);}]) {
    const altered=structuredClone(raw);change(altered);
    assert.throws(()=>validateSourceContractWitness(altered,binding,dir,report,envelope),/witness\/identity/);
  }
  assert.throws(()=>validateSourceContractWitness(raw,binding,dir,{testResults:[]},envelope),/did not execute/);
  write(SOURCE_CONTRACTS[0],canary+'\n// changed exact source');
  assert.throws(()=>validateSourceContractWitness(raw,binding,dir,report,envelope),/Stale/);
  fs.unlinkSync(path.join(dir,SOURCE_CONSUMER));
  assert.throws(()=>sourceContractBinding(dir,[SOURCE_CONTRACTS[0]]));
  assert.throws(()=>sourceContractBinding(dir,['tests/fixtures/unconsumed.json']),/Unknown/);
}));

test('fixture contract consumes all annotations against the pinned generator, without audio credit',()=>fixture(({dir,write})=>{
  const words=['um','uh','um','you know','uh','um','uh','um'];
  const items=words.map((word,i)=>({word,anchor:`anchor ${i}`}));
  const manifest={fixtures:{open_mic_tts:{kind:'synthetic',sha256:'a'.repeat(64),groundTruthFillers:{um:4,uh:3,'you know':1},
    fillerAnnotations:{source:'script, not audio-bound',items},knownFixtureLimits:['needs human recording']}}};
  write('tests/fixtures/rwt/generate-rwt-tts-fixtures.sh',`OPEN_MIC="${items.map(({word,anchor})=>`${word}, ${anchor}`).join('. ')}"\n`);
  const source=JSON.stringify(manifest);
  write(SOURCE_CONTRACTS[2],source);assert.equal(executionRoute(SOURCE_CONTRACTS[2],dir).applicable,true);
  const absent=structuredClone(manifest);delete absent.fixtures.open_mic_tts.fillerAnnotations;
  write(SOURCE_CONTRACTS[2],JSON.stringify(absent));assert.equal(executionRoute(SOURCE_CONTRACTS[2],dir).applicable,false);
  write(SOURCE_CONTRACTS[2],source);
  const proof=inspectSourceContract(dir,SOURCE_CONTRACTS[2],source);
  assert.equal(proof.annotationCount,8);assert.equal(proof.audioExecution,'NOT RUN');
  const wrong=structuredClone(manifest);wrong.fixtures.open_mic_tts.groundTruthFillers.uh=2;
  assert.throws(()=>inspectSourceContract(dir,SOURCE_CONTRACTS[2],JSON.stringify(wrong)),/disagreement/);
  const unconsumed=structuredClone(manifest);unconsumed.fixtures.open_mic_tts.fillerAnnotations.items[1].anchor='not in generator';
  assert.throws(()=>inspectSourceContract(dir,SOURCE_CONTRACTS[2],JSON.stringify(unconsumed)),/not consumed/);
}));

test(SOURCE_ASSERTION,()=>{
  const binding=JSON.parse(process.env.TEST_EFFICACY_BINDING || 'null');
  if(!binding?.sourceContract) {assert.equal(binding?.sourceContract,undefined);return;}
  const witness=consumeSourceContracts(process.cwd(),binding);
  assert.equal(witness.liveExecution,'NOT RUN');
  fs.writeFileSync(binding.sourceContract.witnessFile,JSON.stringify(witness));
});
