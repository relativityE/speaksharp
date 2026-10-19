// Independent exact-source validator/adapter/finalizer controls; existing fixture builders only, no authored test runner.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const head='2f10a0578aee4281e44d446f979d3af86327dc8d';
const parent='7e920bd69354048e96e470c6e469d21ffc2d1c3a';
const hashes={};
const cache=new Map();
function read(pin,path) {
 const source=execFileSync('git',['show',pin+':'+path],{encoding:'utf8'});
 hashes[pin+':'+path]=createHash('sha256').update(source).digest('hex');
 return source;
}
function load(pin,path,override) {
 const key=pin+':'+path+(override?'#fixture':'');
 if(cache.has(key))return cache.get(key).exports;
 const source=override??read(pin,path);
 const module={exports:{}};cache.set(key,module);
 const req=name=>{
  if(name==='vitest')return {}; // fixture prefix imports but never invokes Vitest.
  if(!name.startsWith('.'))return require(name);
  const full=posix.normalize(posix.join(posix.dirname(path),name));
  return load(pin,/\.[cm]?[jt]s$/.test(full)?full:full+'.ts');
 };
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module,exports:module.exports,require:req,Buffer,URL,console,process,setTimeout,clearTimeout}, {filename:path});
 return module.exports;
}
const validatorPath='frontend/src/services/telemetry/coachingDiagnosticReceipt.ts';
const current=load(head,validatorPath),old=load(parent,validatorPath);
const fixturePath='tests/unit/rwtReceivedFailureChain1593.test.ts';
const fixtureSource=read(head,fixturePath);
const prefix=fixtureSource.slice(0,fixtureSource.indexOf("describe('#1593 case7"));
assert(prefix.includes('function finalize('));
const f=load(head,fixturePath,prefix+'\nmodule.exports={chain,binding,receivedFailure,receivedFeedback,finalize,sha,RELEASE};');
const row=await f.chain();
const expected=f.binding(row);
assert(current.validExpectation(expected));
const controls=[];
const evaluate=(mods={},rowsOverride)=>current.evaluateCoachingDiagnosticReceipt(
 rowsOverride??[f.receivedFailure(mods),f.receivedFeedback()],expected,f.RELEASE,f.sha);
function check(name,actual,want){assert.equal(actual,want,name);controls.push({name,expected:want,actual});}
const prior=old.evaluateCoachingDiagnosticReceipt([f.receivedFailure({providerAttempts:4}),f.receivedFeedback()],expected,f.RELEASE,f.sha);
check('returned parent accepts impossible four attempts',prior.verdict,'PASS');
for(const n of [1,2,3])check('fresh failure accepts governed attempts '+n,evaluate({providerAttempts:n}).verdict,'PASS');
for(const [label,n] of [['zero',0],['negative',-1],['fractional',1.5],['four',4],['max-safe',Number.MAX_SAFE_INTEGER],['infinity',Infinity],['NaN',NaN],['string','3'],['null',null],['missing',undefined]]){
 const r=evaluate({providerAttempts:n});check('fresh failure rejects '+label+' attempts',r.verdict,'FAIL');assert(r.reasons.includes('provenance_incoherent'));
}
check('wrong attempt fails',evaluate({attemptId:'99999999-9999-4999-8999-999999999999'}).verdict,'FAIL');
check('wrong product fails',evaluate({product:'focus_points'}).verdict,'FAIL');
check('wrong configured model fails',evaluate({configuredModel:'other-model'}).verdict,'FAIL');
check('missing positive failure release fails',evaluate({clientReleaseId:null}).verdict,'FAIL');
check('wrong release fails',evaluate({clientReleaseId:'c'.repeat(40)}).verdict,'FAIL');
check('unknown source with provider call fails',evaluate({source:'unknown',providerAttempts:1}).verdict,'FAIL');
check('cache cannot claim failure provider provenance',evaluate({source:'cache',providerAttempts:0,providerStatus:null}).verdict,'FAIL');
check('pre-provider refusal zero attempts remains coherent',evaluate({source:'unknown',providerAttempts:0,providerStatus:null,status:403}).verdict,'PASS');
check('malformed endpoint fails',evaluate({status:'502'}).verdict,'FAIL');
check('missing terminal diagnostic holds',evaluate({},[f.receivedFeedback()]).verdict,'HOLD');
check('missing stored feedback holds',evaluate({},[f.receivedFailure()]).verdict,'HOLD');
check('duplicate terminal diagnostic fails',evaluate({},[f.receivedFailure(),f.receivedFailure(),f.receivedFeedback()]).verdict,'FAIL');
check('wrong feedback link fails',evaluate({},[f.receivedFailure(),f.receivedFeedback({coachingDiagnosticId:'different'})]).verdict,'FAIL');
const result=evaluate();
check('matching assurance can settle its own chain',f.finalize(row,result,'FAIL').chain.verdict,'PASS');
check('settled assurance preserves coaching FAIL',f.finalize(row,result,'FAIL').finalAcceptance,'FAIL');
const external=f.finalize(row,result,'EXTERNAL');
check('settled assurance preserves EXTERNAL incomplete',external.finalAcceptance,'INCOMPLETE');
check('EXTERNAL successful coaching remains outstanding',external.successfulCoachingOutstanding,true);
check('generic journey evidence alone cannot settle failure chain',f.finalize(row).chain.verdict,'HOLD');
const output={observedAtUtc:new Date().toISOString(),head,parent,hashes,groupedControls:controls.length,controls,
 scope:'Actual adapter, received validator and unchanged finalizer with synthetic stored/received observations; fixture builders reused, assertions executed independently. Not CLI full quality/281-test suite, live telemetry ingestion or Production acceptance.',
 disposition:'Bounded attempt-ceiling correction and failure-outcome preservation pass. Fresh exact-head CI/reviews and Sam whole-source/release decision remain separate.',
 newLiveRuns:0,providerCalls:0,accountOperations:0};
writeFileSync(new URL('results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output));

