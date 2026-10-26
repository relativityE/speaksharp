import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOURCE_CONTRACTS,SOURCE_CONSUMER,SOURCE_ASSERTION,inspectSourceContract,sourceContractBinding,
  consumeSourceContracts,validateSourceContractWitness} from '../../scripts/lib/sourceContractEvidence.mjs';
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
humanObservation(receipt, 'open_mic_uh_detected', 'human');`;

test('source contracts reject missing wires and comments posing as execution',()=>{
  for(const [file,source] of [[SOURCE_CONTRACTS[0],canary],[SOURCE_CONTRACTS[1],filler]]) {
    const proof=inspectSourceContract(root,file,source);
    assert.equal(proof.liveExecution,'NOT RUN');assert.equal(proof.detectedFaults,file===SOURCE_CONTRACTS[0]?7:6);
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
