import fs from 'node:fs';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const hash = value => createHash('sha256').update(value).digest('hex');
export function requests(bytes) {
  const frozen = JSON.parse(bytes);
  if (frozen.model !== 'gemini-3.8-flash' || frozen.sourceSha !== '524c325a95874d31239203dce9ef7893331ca756') throw Error('request_identity');
  const baseline = frozen.body;
  if (baseline.generationConfig.thinkingConfig.thinkingLevel !== 'low') throw Error('thinking_identity');
  const prompt = baseline.contents[0].parts[0].text;
  if (Buffer.byteLength(prompt) > 4096) throw Error('prompt_bound');
  const variant = structuredClone(baseline);
  for (const key of ['what_worked','what_to_try_next']) {
    if (variant.generationConfig.responseSchema.properties[key].pattern !== '.*\\S.*') throw Error('schema_identity');
    delete variant.generationConfig.responseSchema.properties[key].pattern;
  }
  return { frozen, bodies: [JSON.stringify(baseline), JSON.stringify(variant)] };
}
const safeCode = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(v) ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
export function decode(text) {
  let body; try { body = JSON.parse(text); } catch { return { outcome: 'invalid_json' }; }
  const usage = body.usageMetadata;
  let answer; try { answer=JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text); } catch { /* closed outcome below */ }
  const valid = answer && Object.keys(answer).sort().join(',')==='version,what_to_try_next,what_worked' && answer.version === 'gemini_coaching_v1' && ['what_worked','what_to_try_next'].every(k=>typeof answer[k]==='string'&&answer[k].trim().length>0&&answer[k].trim().length<=240);
  return { outcome: valid ? 'contract_valid' : body.error ? 'provider_error' : 'contract_invalid', modelVersion:safeCode(body.modelVersion),finishReason:safeCode(body.candidates?.[0]?.finishReason), providerErrorCode:count(body.error?.code),providerErrorStatus:safeCode(body.error?.status),tokens:usage ? {input:count(usage.promptTokenCount),output:count(usage.candidatesTokenCount),thinking:count(usage.thoughtsTokenCount),total:count(usage.totalTokenCount)}:null };
}
export function sendOnce(body,key,request=https.request,timeoutMs=90000) {
  return new Promise(resolve=>{
    const startedAt=new Date().toISOString(),start=performance.now();let status=null,headersMs=null,settled=false,timer,req;
    const finish=extra=>{if(settled)return;settled=true;clearTimeout(timer);resolve({startedAt,status,headersMs,elapsedMs:Math.round(performance.now()-start),...extra});};
    try {
      req=request({hostname:'generativelanguage.googleapis.com',port:443,path:'/v1beta/models/gemini-3.8-flash:generateContent?key='+encodeURIComponent(key),method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
        status=res.statusCode;headersMs=Math.round(performance.now()-start);let text='',size=0;
        res.setEncoding('utf8');res.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>1048576){finish({outcome:'response_size_limit',usageUnknown:true});req.destroy();}else text+=chunk;});
        res.on('end',()=>finish(decode(text)));res.on('error',()=>finish({outcome:'response_interrupted',usageUnknown:true}));
        res.on('aborted',()=>finish({outcome:'response_interrupted',usageUnknown:true}));
      });
      timer=setTimeout(()=>{finish({outcome:'client_timeout_90s',usageUnknown:true});req.destroy();},timeoutMs);
      req.on('error',()=>finish({outcome:'transport_error',usageUnknown:true}));req.end(body);
    } catch { finish({outcome:'transport_error',usageUnknown:true}); }
  });
}
export async function run({bytes,key,call=sendOnce,persist=()=>{},context}) {
  const {frozen,bodies}=requests(bytes);const report={schemaVersion:1,experiment:'two-call-schema-diagnostic',sourceSha:frozen.sourceSha,requestFixtureSha256:hash(bytes),fixtureId:frozen.fixtureId,model:frozen.model,thinking:'low',timeoutMs:90000,noRetries:true,requestCountLimit:2,scope:'Direct provider only; no app/database/deploy effects; not a p95 or timeout qualification.',context,records:[]};
  persist(report);
  for(let i=0;i<2;i++){
    const record={variant:i===0?'production_matching':'schema_regex_removed',requestSha256:hash(bodies[i]),state:'attempt_started',ordinal:i+1};report.records.push(record);persist(report);
    Object.assign(record,await call(bodies[i],key),{state:'attempt_finished'});persist(report);
    if([401,403].includes(record.status)){report.stopped='access_refused_no_retry';break;}
  }
  return report;
}
async function main(){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_RUN_ATTEMPT!=='1'||process.env.GITHUB_REF!=='refs/heads/sam/gemini-two-call-diagnostic-20261110'||process.env.EXPECTED_SHA!==process.env.GITHUB_SHA||process.env.CONFIRM_TWO_CALLS!=='TWO-PAID-GEMINI-CALLS')throw Error('dispatch_guard');
  const key=process.env.GEMINI_API_KEY;if(!key)throw Error('credential_missing');
  const bytes=fs.readFileSync(new URL('./gemini-two-call-request.json',import.meta.url));
  if(hash(bytes)!=='9a23dc37b9a34a542b2302831a36b2e64c242319d3a7d3e1139e113766af2457')throw Error('frozen_request_drift');
  fs.mkdirSync('artifacts/gemini-two-call',{recursive:true});const out='artifacts/gemini-two-call/result.json';fs.writeFileSync(out,'',{flag:'wx',mode:0o600});
  const report=await run({bytes,key,persist:r=>fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{mode:0o600}),context:{commit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:1}});
  const lines=['## Two-call Gemini diagnostic','Synthetic prompt only. No retries. 90-second experimental timeout.','',...report.records.map(r=>`- ${r.variant}: HTTP ${r.status??'unobserved'}, ${r.elapsedMs} ms, ${r.outcome}; usage ${JSON.stringify(r.tokens??null)}.`),'','Two observations do not establish p95, causality, or a production timeout.'];
  const summary=lines.join('\n')+'\n';fs.writeFileSync('artifacts/gemini-two-call/summary.md',summary);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);console.log(summary);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Diagnostic stopped before completion. Inspect sanitized artifact; do not rerun an uncertain attempt.');process.exitCode=1;});
