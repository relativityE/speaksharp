'use strict';
const {sanitizeEvidence}=require('./evidence-sanitizer.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const RESULTS=new Set(['PASS','FAIL','NOT RUN']);
function validateCaseConfig(c) {
 if(!/^AHT-(?:0[1-9]|1[0-5])$/.test(c?.caseId||'')) throw new Error('caseId must be AHT-01 through AHT-15');
 if(!Array.isArray(c.requiredAssertions)||!c.requiredAssertions.length||new Set(c.requiredAssertions).size!==c.requiredAssertions.length||c.requiredAssertions.some(x=>typeof x!=='string'||!x.trim())) throw new Error('exact nonempty requiredAssertions must be bound');
 if(!/^[a-f0-9]{40}$/.test(c.sourceSha||'') || c.sourceSha!==c.servedSha) throw new Error('aligned exact source/served full SHA required');
 if(!['https://speaksharp-public.vercel.app','https://speaksharp-public.vercel.app/'].includes(c.targetUrl)) throw new Error('canonical target URL required');
 return c;
}
// Assertion detail is a closed list of static sentences; any other text is replaced so prose can never ride in a row.
const BLOCKED_DETAIL='<blocked-text>';
const STATIC_DETAILS=new Set(['The named source assertion was observed.','Observed behavior contradicts the named source assertion.','The named assertion was not established.','Reviewed source-specific oracle result.','Server-evidence assertion NOT RUN: no authorized evidence reader available; browser observations continue.']);
function validateAssertion(a) {
 if(!a||typeof a.id!=='string'||!a.id.trim()||!RESULTS.has(a.result)||typeof a.detail!=='string'||a.detail.length>2000)throw new Error('invalid content-safe assertion');
 if(!Array.isArray(a.evidenceRefs)||a.evidenceRefs.some(x=>typeof x!=='string'||path.isAbsolute(x)||x.split(/[\\/]/).some(p=>!p||p==='..'||p==='.')||x.includes('\\')))throw new Error('relative scoped evidence references required');
 if(a.result==='PASS'&&!a.evidenceRefs.length)throw new Error('PASS needs actual evidence reference');
 const row={id:a.id,result:a.result,detail:STATIC_DETAILS.has(a.detail)?a.detail:BLOCKED_DETAIL,evidenceRefs:[...a.evidenceRefs]};if(a.interruptedBy==='request-allowance'&&RESULTS.has(a.observedResult)){row.interruptedBy='request-allowance';row.observedResult=a.observedResult;}return row;
}
function summarizeAssertions(config,assertions) {
 validateCaseConfig(config);const map=new Map();
 for(const raw of assertions){const a=validateAssertion(raw);if(map.has(a.id))throw new Error('duplicate assertion '+a.id);map.set(a.id,a);}
 const rows=config.requiredAssertions.map(id=>map.get(id)||{id,result:'NOT RUN',detail:'Required assertion was not exercised or returned',evidenceRefs:[]});
 for(const [id,a]of map)if(!config.requiredAssertions.includes(id))rows.push(a);
 const result=rows.some(a=>a.result==='FAIL')?'FAIL':rows.every(a=>a.result==='PASS')?'PASS':'NOT RUN';
 const out={caseId:config.caseId,sourceSha:config.sourceSha,servedSha:config.servedSha,result,assertions:rows,contentSafe:true,realHumanObservations:'NOT_CLAIMED'};
 const affected=rows.filter(r=>r.interruptedBy==='request-allowance');if(affected.length)out.interruption={kind:'request-allowance',affectedChecks:affected.length};
 return out;
}
// Harness rows that describe the harness itself, not the product: never reclassified by an interruption.
const HARNESS_ROWS=new Set(['owned-pages-closed','start-press-budget','no-cloud-stt']);
function createCaseRecorder(config,runDir,options={}) {
 validateCaseConfig(config);const rows=new Map();const base=path.resolve(runDir);
 const persist=()=>{const result=summarizeAssertions(config,[...rows.values()]);result.evidenceDigests={};for(const ref of [...new Set(result.assertions.flatMap(a=>a.evidenceRefs))]){const f=path.resolve(base,ref);if(!f.startsWith(base+path.sep)||fs.lstatSync(f).isSymbolicLink()||!fs.statSync(f).isFile())throw new Error('evidence missing or outside run');result.evidenceDigests[ref]=sha(fs.readFileSync(f));}fs.writeFileSync(path.join(base,'case-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;};
 // A check recorded after the guard refused a request for lack of per-case allowance was disturbed by the harness, not the product: it becomes NOT RUN
 // (the observed result is kept as a closed field). Anything recorded BEFORE the refusal, including a genuine FAIL, stands unchanged.
 function recordAssertion(raw){let a=validateAssertion(raw);const old=rows.get(a.id);
  if(typeof options.interrupted==='function'&&options.interrupted()===true&&!HARNESS_ROWS.has(a.id)){if(old)return persist();if(a.result!=='NOT RUN')a={...a,result:'NOT RUN',detail:'The named assertion was not established.',interruptedBy:'request-allowance',observedResult:a.result};else a={...a,interruptedBy:'request-allowance',observedResult:'NOT RUN'};}
  if(old?.result==='FAIL' && a.result!=='FAIL')return persist();if(old&&old.result===a.result&&JSON.stringify(old)!==JSON.stringify(a))throw new Error('ambiguous duplicate assertion');rows.set(a.id,a);return persist();}
 function writeEvidence(name,value){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(name)||value?.contentSafe!==true)throw new Error('content-safe named JSON evidence required');const cleaned=sanitizeEvidence(value);const bytes=Buffer.from(JSON.stringify({...cleaned.value,contentSafe:true,sanitizer:cleaned.stats},null,2)+'\n');fs.writeFileSync(path.join(base,name),bytes,{flag:'wx',mode:0o600});return name;}
 function finish(returned){if(returned){if(returned.caseId!==config.caseId||returned.contentSafe!==true||!Array.isArray(returned.assertions))throw new Error('driver result contract missing');for(const a of returned.assertions)recordAssertion(a);}const result=persist();for(const a of result.assertions)for(const ref of a.evidenceRefs){const f=path.resolve(base,ref);if(!f.startsWith(base+path.sep)||fs.lstatSync(f).isSymbolicLink()||!fs.statSync(f).isFile())throw new Error('evidence missing or outside run');}result.evidenceDigests=Object.fromEntries([...new Set(result.assertions.flatMap(a=>a.evidenceRefs))].map(ref=>[ref,sha(fs.readFileSync(path.join(base,ref)))]));fs.writeFileSync(path.join(base,'case-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;}
 persist();return {recordAssertion,writeEvidence,finish,preserve:()=>persist()};
}
function credentialBinding(config,env=process.env) {
 const allowed=[['THROWAWAY_TEST_EMAIL','THROWAWAY_TEST_PASSWORD'],['FREE_TEST_EMAIL','FREE_TEST_PASSWORD'],['PRO_TEST_EMAIL','PRO_TEST_PASSWORD']];
 const pair=config.credentialVars;
 if(!pair||!allowed.some(([email,password])=>pair.email===email&&pair.password===password))throw new Error('NOT_RUN: approved credential-variable pair not bound');
 if(!env[pair.email]||!env[pair.password])throw new Error('NOT_RUN: selected credential variables unavailable');
 return Object.freeze({email:env[pair.email],password:env[pair.password]});
}
module.exports={validateCaseConfig,validateAssertion,summarizeAssertions,createCaseRecorder,credentialBinding};
