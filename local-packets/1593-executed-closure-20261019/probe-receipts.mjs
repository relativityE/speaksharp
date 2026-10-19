import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),ts=require('typescript');
const head='c8dc89f06a2ac7d58706c4cb02a80e0dd0ebbab3',cache=new Map(),hashes={};
function load(p){if(cache.has(p))return cache.get(p).exports;const source=execFileSync('git',['show',head+':'+p],{encoding:'utf8'});hashes[p]=createHash('sha256').update(source).digest('hex');const m={exports:{}};cache.set(p,m);const req=id=>{if(!id.startsWith('.'))return require(id);const b=path.posix.normalize(path.posix.join(path.posix.dirname(p),id));for(const ext of ['.ts','.tsx','/index.ts']){try{execFileSync('git',['cat-file','-e',head+':'+b+ext],{stdio:'ignore'});return load(b+ext);}catch(e){if(e.status===undefined)throw e;}}throw Error('Missing dependency '+b);};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,require:req,Buffer,URL,console,process,Date,setTimeout,clearTimeout});return m.exports;}
const api=load('tests/live/helpers/rwtAcceptance.ts');
const inputs=JSON.parse(readFileSync('artifacts/pm-closure-private/retained-receipts.json','utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));const controls=[];
for(const row of inputs){if(!row.receipt){controls.push({case:row.case,kind:'actual_missing_receipt',disposition:'HOLD',reason:'No RWT_RECEIPT in actual original job log; no substitute invented'});continue;}const v=api.validateReceipt(row.receipt);controls.push({case:row.case,kind:'actual_receipt_current_validator',errors:v.errors,acceptance:api.receiptAcceptance(row.receipt.rows).acceptance});}
const p='artifacts/pm-closure-private/case08/feedback-association-boundaries-no-session';
const raw=JSON.parse(readFileSync(p+'.receipt.json','utf8')),rb=JSON.parse(readFileSync(p+'.readback-verdicts.json','utf8')),ws=api.parseHumanWorksheet(readFileSync(p+'.human-worksheet.md','utf8'));
const baseline=api.finalizeReceipt(raw,ws,rb);assert.equal(baseline.finalAcceptance,'PASS');assert.equal(baseline.errors.length,0);controls.push({name:'actual case8 receipt + actual worksheet + actual received artifact',status:baseline.status,acceptance:baseline.finalAcceptance,errors:baseline.errors});
for(const [name,mutate,target] of [
 ['wrong worksheet release',x=>x.release='0'.repeat(40),'worksheet'],
 ['wrong received release',x=>x.release='0'.repeat(40),'readback'],
 ['wrong received journey',x=>x.journeys[0].journeyId='00000000-0000-4000-8000-000000000000','readback'],
 ['missing received terminal',x=>x.journeys[0].verdict='HOLD','readback'],
 ['wrong worksheet journey',x=>x.journeyIds=['00000000-0000-4000-8000-000000000000'],'worksheet']]){
 const w=clone(ws),r=clone(rb);mutate(target==='worksheet'?w:r);const out=api.finalizeReceipt(raw,w,r);assert.notEqual(out.finalAcceptance,'PASS');controls.push({name,status:out.status,acceptance:out.finalAcceptance,errors:out.errors});
}
const runMutation=clone(raw);runMutation.meta={...runMutation.meta,runId:'synthetic-wrong-run'};
const runResult=api.finalizeReceipt(runMutation,ws,rb);controls.push({name:'wrong run metadata is outside existing parser binding schema',acceptance:runResult.finalAcceptance,errors:runResult.errors,scope:'Does not assert a defect: suite/release/journey parser does not authenticate workflow run. Verify artifact run/attempt metadata separately.'});
for(const n of [1,2,3,15]){const r=inputs.find(x=>x.case===n).receipt;const w={suite:r.suite,release:r.release,journeyIds:api.runJourneyIds(r.readback||{journeys:[],reportedJourneyIds:[]}),receipt:r.suite+'.receipt.json',entries:r.rows.filter(x=>x.evidence?.observationId).map(x=>({id:x.evidence.observationId,result:'',observer:''}))};const out=api.finalizeReceipt(r,w);assert.notEqual(out.finalAcceptance,'PASS');controls.push({case:n,name:'actual receipt with blank human observations',acceptance:out.finalAcceptance,errors:out.errors});}
const r15=inputs.find(x=>x.case===15).receipt;
const humanRows=r15.rows.filter(x=>x.evidence?.observationId);const signed={suite:r15.suite,release:r15.release,journeyIds:api.runJourneyIds(r15.readback||{journeys:[],reportedJourneyIds:[]}),receipt:r15.suite+'.receipt.json',entries:humanRows.map(x=>({id:x.evidence.observationId,result:'PASS',observer:'SYNTHETIC desktop substitute — not real observation'}))};
const desktop=api.finalizeReceipt(r15,signed);controls.push({case:15,name:'synthetic desktop label cannot establish physical evidence',acceptance:desktop.finalAcceptance,errors:desktop.errors,scope:'Parser verifies signed cells/bindings, not physical truth; actual access HOLD remains. Do not treat an accepted signature as phone verification.'});
const adverse=load('tests/live/helpers/rwtAdverse.ts');
{
 const f=new adverse.AttemptFaultCounter(),own={},wrong={};f.startAttempt();f.onRequest(own,'https://offline.invalid/models/config.json');f.armFault();f.onFailed(wrong);
 const row={exercised:f.failures>0,observed:true,statuses:['loading','error'],finalStatus:'error',retryOffered:true,mode:'private'};
 const missing=adverse.downloadFailureVerdict(row);assert.equal(missing.status,'HOLD');controls.push({name:'wrong fault request object cannot exercise actual adverse predicate',verdict:missing.status});
 f.onFailed(own);const valid=adverse.downloadFailureVerdict({...row,exercised:f.failures>0});assert.equal(valid.status,'PASS');controls.push({name:'matching current-attempt config fault is valid in accepted fresh-context scope',verdict:valid.status});
 const lost=adverse.downloadFailureVerdict({...row,exercised:true,observed:false,statuses:[]});assert.equal(lost.status,'HOLD');controls.push({name:'missing adverse observation history',verdict:lost.status});
}
{
 const a=load('tests/live/helpers/rwtAbandonTakeover.ts');const before=[{id:'old',status:'active'}],after=[{id:'new',status:'completed'}];
 const wrong=a.nextTakeOnlyItselfVerdict(before,after,'wrong');assert.equal(wrong.status,'FAIL');controls.push({name:'wrong successor take rejected by actual row oracle',verdict:wrong.status});
 const absent=a.nextTakeOnlyItselfVerdict(before,after,'new');assert.equal(absent.status,'PASS');controls.push({name:'current row-count oracle has no fence/authority input',verdict:absent.status,scope:'Existing assigned case10 gap: a PASS here cannot establish permanent fence or authority exclusion. New approved CLI oracle/caller capture must supply those facts; no competing validator built.'});
 const displaced=a.nextTakeOnlyItselfVerdict(before,[{id:'old',status:'active',recording_fenced_reason:'displaced',recording_fenced_at:'synthetic-only'},{id:'new',status:'completed'}],'new');assert.equal(displaced.status,'FAIL');controls.push({name:'current oracle still rejects legitimate recoverable-row shape despite supplied synthetic fence annotation',verdict:displaced.status,scope:'Known case10 mismatch retained, not newly discovered or historical fencing proof.'});
}
{
 const synthetic=clone(r15);synthetic.rows=synthetic.rows.map(r=>r.step==='returning-user access'?{...r,verdict:'PASS',detail:'SYNTHETIC NEGATIVE CONTROL ONLY: assume eligibility to isolate signature trust boundary'}:r);
 const out=api.finalizeReceipt(synthetic,signed);assert.equal(out.finalAcceptance,'PASS');controls.push({name:'negative control: desktop-labelled signatures plus synthetic eligibility pass parser, not physical truth',acceptance:out.finalAcceptance,errors:out.errors,scope:'Synthetic mutated actual receipt, never an actual case15 result. Existing parser cannot authenticate device reality; original actual access remains HOLD and all real human observations blank.'});
}
const result={head,observedAtUtc:new Date().toISOString(),hashes,controlCount:controls.length,controls,scope:'Actual pinned existing receipt parser/finalizer on actual log receipts and actual downloaded case8 archive; labelled negative mutations. No live closure or invented human observation. Case8 historical PASS is independently recomputed.'};writeFileSync(new URL('receipt-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
