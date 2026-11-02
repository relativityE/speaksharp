'use strict';
// Exact main70e user_issue_reports insert contract. PURE; no network or caller-supplied clients.
// Synthetic rejection is a harness control, NOT evidence that the actual server rejected a row.
const crypto=require('node:crypto');const {isDeepStrictEqual}=require('node:util');
const {immutableJsonCopy}=require('./fault-contract.cjs');
const FIXTURE_SOURCE_SHA='0000000000000000000000000000000000000003';
const SOURCE_SHA='66328703bf47e865b730e229005411e78481d34c',HOST='yxlapjuovrsvjswkwnrk.supabase.co',PATH='/rest/v1/user_issue_reports';
const MODES=Object.freeze(['transport-before-send','synthetic-42501','stored-response-lost']);
const FIELDS=Object.freeze(['user_id','session_id','category','severity','title','description','page_url','metadata','include_audio','audio_attachment_note','idempotency_key']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA=/^[0-9a-f]{64}$/;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const store=new WeakMap();
function invalid(message){throw new Error('HARNESS_LIMITED: '+message);}
function subject(headers){const entries=Object.entries(headers||{}).filter(([k])=>k.toLowerCase()==='authorization');if(entries.length!==1||typeof entries[0][1]!=='string'||entries[0][1].length>32768)invalid('feedback bearer identity unavailable');const token=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(entries[0][1]);if(!token)invalid('feedback bearer identity unavailable');const sub=JSON.parse(Buffer.from(token[1].split('.')[1],'base64url')).sub;if(typeof sub!=='string')invalid('feedback bearer subject unavailable');return sha(sub);}
function parseRow(body){if(!Buffer.isBuffer(body)||body.length>1048576)invalid('feedback body unavailable');const row=JSON.parse(body.toString('utf8'));if(!row||Array.isArray(row)||Object.keys(row).length!==FIELDS.length||FIELDS.some(k=>!Object.hasOwn(row,k)))invalid('feedback insert is not the exact reviewed row shape');if(!UUID.test(row.user_id||'')||!UUID.test(row.session_id||'')||!UUID.test(row.idempotency_key||''))invalid('feedback owner/session/draft identity invalid');if(typeof row.description!=='string'||row.description!==row.description.trim()||!row.description||typeof row.title!=='string'||!row.title||typeof row.page_url!=='string'||!row.page_url.startsWith('/')||typeof row.category!=='string'||typeof row.severity!=='string'||row.include_audio!==false||row.audio_attachment_note!==null||!row.metadata||Array.isArray(row.metadata))invalid('feedback content/type contract invalid');return row;}
function stableDraft(row){
 // Main70e rebuilds operational metadata on Retry (e.g. sentryLastEventId after the first error).
 // Source draftSignature is type/body/severity/session; retain all persisted draft fields and its
 // owner/coaching/release association, while recording EACH original full-body hash separately.
 const {metadata,...fields}=row;return {...fields,metadata:{feedback_type:metadata.feedback_type??null,feedback_kind:metadata.feedback_kind??null,feedback_severity:metadata.feedback_severity??null,coaching_diagnostic_ref:metadata.coaching_diagnostic_ref??null,releaseId:metadata.releaseId??null}};
}
function plainInsertPreferences(headers,response=false){
 const name=response?'preference-applied':'prefer',entries=Object.entries(headers||{}).filter(([k])=>k.toLowerCase()===name);
 if(entries.length>1||entries.some(([,v])=>typeof v!=='string'))return false;
 if(!entries.length||!entries[0][1].trim())return true;
 // Exact source uses plain .insert(row), no upsert, conflict resolution or rollback preference.
 const allowed=response?new Set(['return=minimal','tx=commit']):new Set(['return=minimal']);
 const parts=entries[0][1].split(',').map(s=>s.trim().toLowerCase());return parts.length===new Set(parts).size&&parts.every(s=>allowed.has(s));
}
function publicWriteSchema(headers,rawHeaders){
 // The inspected service uses the client's default public schema. PostgREST chooses a write
 // schema via Content-Profile, so a same-named table/index in another schema is not this proof.
 const entries=Object.entries(headers||{}).filter(([k])=>k.toLowerCase()==='content-profile');
 if(entries.length>1||entries.length===1&&entries[0][1]!=='public')return false;
 if(rawHeaders!==undefined){
  if(!Array.isArray(rawHeaders)||rawHeaders.length%2||rawHeaders.some(v=>typeof v!=='string'))return false;
  const values=[];for(let i=0;i<rawHeaders.length;i+=2)if(rawHeaders[i].toLowerCase()==='content-profile')values.push(rawHeaders[i+1]);
  if(values.length!==entries.length||values.length>1||values.length===1&&values[0]!=='public')return false;
 }
 return true;
}
function successfulInitialInsert({status,complete,forwarded,bodyBuffer,responseHeaders}){
 // Default PostgREST plain INSERT returns201 with no representation. Never suppress2xx substitutes,
 // error-shaped bodies, incomplete responses, resolution/upsert or rollback acknowledgements.
 return status===201&&complete===true&&forwarded===true&&Buffer.isBuffer(bodyBuffer)&&bodyBuffer.length===0&&plainInsertPreferences(responseHeaders,true);
}
function isReplay(error,key){return !!error&&error.code==='23505'&&typeof error.message==='string'&&error.message.includes('"user_issue_reports_idempotency_key_unique"')&&(error.details===''||error.details==null||typeof error.details==='string'&&error.details.includes('(idempotency_key)=('+key+')'));}
function validateFeedbackBinding(f,fixtureOnly=false){if(!f||Object.keys(f).sort().join(',')!=='accountSubjectSha256,descriptionSha256,expectedSessionSha256,host,id,mode,sourceSha'||![...MODES,'observe-once'].includes(f.mode)||!(f.sourceSha===SOURCE_SHA&&f.host===HOST||fixtureOnly&&f.sourceSha===FIXTURE_SOURCE_SHA&&f.host==='a.test')||typeof f.id!=='string'||!f.id||['accountSubjectSha256','descriptionSha256','expectedSessionSha256'].some(k=>!SHA.test(f[k]||'')))invalid('exact reviewed feedback binding required');return Object.freeze({...f});}
class FeedbackFault {
 constructor(binding,options={}){this.binding=validateFeedbackBinding(binding,options.fixtureOnly===true);store.set(this,{capture:null,attempts:[],retryMarked:false,problem:null,fired:false});}
 matchesRoute(r){return r.host===this.binding.host&&r.method==='POST'&&r.pathname===PATH;}
 matchesCapturedKey(request){const s=store.get(this);if(!s.capture)return false;try{return parseRow(request.bodyBuffer).idempotency_key===s.capture.row.idempotency_key;}catch{return false;}}
 awaitingInitial(){return !store.get(this).capture;}
 inspect(request){const s=store.get(this);if(!this.matchesRoute(request))return null;let row;
   try{if(request.search)invalid('feedback query override refused');if(!publicWriteSchema(request.headers,request.rawHeaders))invalid('feedback public write schema required');if(!plainInsertPreferences(request.headers))invalid('feedback plain insert preferences required');row=parseRow(request.bodyBuffer);if(subject(request.headers)!==this.binding.accountSubjectSha256||sha(row.user_id)!==this.binding.accountSubjectSha256||sha(row.session_id)!==this.binding.expectedSessionSha256||sha(row.description)!==this.binding.descriptionSha256||row.metadata.feedback_type!=='broke'||row.metadata.feedback_kind!=='issue'||row.metadata.releaseId!==this.binding.sourceSha)invalid('feedback operation scope mismatch');}catch{ s.problem='feedback-operation-unbound';return{action:'deny',reason:s.problem};}
   const bodySha256=sha(request.bodyBuffer),draftSha256=sha(JSON.stringify(stableDraft(row)));
   if(!s.capture){s.capture={row:immutableJsonCopy(row),draftSha256,idempotencySha256:sha(row.idempotency_key),operationDigest:sha(JSON.stringify([this.binding.accountSubjectSha256,this.binding.expectedSessionSha256,sha(row.idempotency_key),draftSha256]))};}
   const index=s.attempts.length+1,identical=draftSha256===s.capture.draftSha256&&row.idempotency_key===s.capture.row.idempotency_key;
   const permitted=!s.problem&&identical&&(index===1||index===2&&s.retryMarked&&this.binding.mode!=='observe-once');
   const attempt={index,requestBodySha256:bodySha256,operationDigest:s.capture.operationDigest,idempotencySha256:s.capture.idempotencySha256,phase:index===1?'initial':s.retryMarked?'explicit-retry-window':'outside-retry-window',outcome:null,status:null,forwarded:false};if(s.attempts.length<4)s.attempts.push(attempt);
   if(!permitted){s.problem='extra-or-changed-feedback-attempt';return{...attempt,action:'deny',reason:s.problem};}
   if(index===2)s.retryRow=immutableJsonCopy(row);
   return{...attempt,action:index===1&&this.binding.mode==='transport-before-send'?'fatal':index===1&&this.binding.mode==='synthetic-42501'?'synthetic-rejection':'forward'};
 }
 canSuppressStoredAcknowledgement(response){const s=store.get(this);return this.binding.mode==='stored-response-lost'&&!s.problem&&s.attempts.length===1&&!s.attempts[0].outcome&&successfulInitialInsert(response);}
 finish(index,{outcome,status,forwarded,bodyBuffer,complete,responseHeaders}){const s=store.get(this),a=s.attempts.find(x=>x.index===index);if(!a||a.outcome)return;Object.assign(a,{outcome,status:Number.isInteger(status)?status:null,forwarded:forwarded===true,complete:complete===true});
   if(index===1){a.initialInsertCreated=successfulInitialInsert({status,complete,forwarded,bodyBuffer,responseHeaders});if(outcome==='feedback-'+this.binding.mode&&(this.binding.mode==='transport-before-send'&&forwarded===false||this.binding.mode==='synthetic-42501'&&status===403&&forwarded===false&&complete===true||this.binding.mode==='stored-response-lost'&&a.initialInsertCreated))s.fired=true;}
   if(index===2){let data;try{data=JSON.parse(bodyBuffer?.toString('utf8')||'null');}catch{}a.idempotentReplay=forwarded===true&&complete===true&&status===409&&plainInsertPreferences(responseHeaders,true)&&isReplay(data,s.capture.row.idempotency_key);a.successfulInsert=successfulInitialInsert({status,complete,forwarded,bodyBuffer,responseHeaders});if(this.binding.mode==='stored-response-lost'&&s.fired&&s.retryMarked&&s.attempts[0]?.initialInsertCreated&&a.successfulInsert)s.problem='feedback-idempotency-contradiction';}
 }
 authorizeRetry(){const s=store.get(this);if(this.binding.mode==='observe-once')invalid('normal feedback permits no Retry');if(s.problem||s.retryMarked||!s.fired||s.attempts.length!==1||!s.attempts[0].outcome)invalid('feedback explicit Retry requires exactly one exercised fault');s.retryMarked=true;return true;}
 readbackBinding(){const s=store.get(this);if(!s.capture)invalid('feedback payload not captured');const u=new URL('https://'+this.binding.host+PATH);u.searchParams.set('select',['id',...FIELDS].join(','));u.searchParams.set('user_id','eq.'+s.capture.row.user_id);u.searchParams.set('session_id','eq.'+s.capture.row.session_id);u.searchParams.set('idempotency_key','eq.'+s.capture.row.idempotency_key);u.searchParams.set('limit','2');return Object.freeze({url:u.href});}
 compareRows(rows,afterRetry=false){const s=store.get(this),expected=afterRetry&&!['stored-response-lost','observe-once'].includes(this.binding.mode)?s.retryRow:s.capture?.row;if(!expected||!Array.isArray(rows)||rows.length!==1||!UUID.test(rows[0]?.id||''))return false;return FIELDS.every(k=>Object.hasOwn(rows[0],k)&&isDeepStrictEqual(rows[0][k],expected[k]));}
 verifyDurableReadback(response,{responseCompletedAt,requestReceiptId}){const r=response?.receipt,b=this.readbackBinding(),start=Date.parse(r?.startedAt),end=Date.parse(r?.completedAt),saved=Date.parse(responseCompletedAt);if(response?.status!==200||response.complete!==true||!Buffer.isBuffer(response.body)||response.body.length>1048576||r?.status!==200||r.complete!==true||r.capsReserved!==true||r.method!=='GET'||r.redirectsFollowed!==0||r.urlSha256!==sha(b.url)||typeof r.requestReceiptId!=='string'||!r.requestReceiptId||r.requestReceiptId===requestReceiptId||![start,end,saved].every(Number.isFinite)||start<saved||end<start)return false;let rows;try{rows=JSON.parse(response.body.toString('utf8'));}catch{return false;}return this.compareRows(rows);}
 expectedOperation(){const s=store.get(this);if(!s.capture)invalid('feedback payload unavailable');return immutableJsonCopy({row:s.capture.row,retryRow:s.retryRow||null,readbackBinding:this.readbackBinding(),operationDigest:s.capture.operationDigest});}
 fail(reason){const s=store.get(this);if(!['extra-or-changed-feedback-attempt','feedback-operation-unbound','feedback-idempotency-contradiction'].includes(s.problem))s.problem=reason;}
 summary(){
  const s=store.get(this),a=s.attempts,mode=this.binding.mode;
  const violation=['extra-or-changed-feedback-attempt','feedback-operation-unbound','feedback-idempotency-contradiction'].includes(s.problem);
  const lostAckStorageConfirmed=mode==='stored-response-lost'&&!s.problem&&s.fired&&s.retryMarked&&a.length===2&&a[0].initialInsertCreated===true&&a[1].outcome==='completed'&&a[1].idempotentReplay===true;
  const exactExpectedAttempts=mode==='observe-once'?(!s.problem&&a.length===1&&a[0].outcome==='completed'&&a[0].initialInsertCreated===true):!s.problem&&s.fired&&s.retryMarked&&a.length===2&&a[1].outcome==='completed'&&(mode==='stored-response-lost'?lostAckStorageConfirmed:a[1].successfulInsert===true);
  const scopes={'transport-before-send':'initial-not-forwarded-then-explicit-insert-201','synthetic-42501':'synthetic-rejection-not-forwarded-then-explicit-insert-201','stored-response-lost':'initial-insert-201-then-explicit-same-key-named-409','observe-once':'one-complete-plain-insert-201'};
  return{id:this.binding.id,mode,injectedFault:mode!=='observe-once',fired:s.fired,problem:s.problem,attemptCount:a.length,retryMarked:s.retryMarked,exactExpectedAttempts,deliveryConfirmed:exactExpectedAttempts,lostAckStorageConfirmed,deliveryProofScope:scopes[mode],persistedAssociation:'NOT_PROVEN',rowCardinality:'NOT_PROVEN_BY_HTTP',attempts:a.map(a=>({...a})),evidenceScope:'guarded-outbound-and-HTTP-response-receipts',syntheticRejection:mode==='synthetic-42501',independentServerReceipts:'UNKNOWN',status:violation?'VIOLATION':exactExpectedAttempts?'COMPLETE':'INCOMPLETE',violation,incomplete:!violation&&!exactExpectedAttempts};
 }

}
const syntheticRejection=Object.freeze({status:403,body:JSON.stringify({code:'42501',message:'HARNESS SYNTHETIC CONTROL: new row violates row-level security policy for table "user_issue_reports"',details:null,hint:null})});
module.exports={FIXTURE_SOURCE_SHA,FeedbackFault,validateFeedbackBinding,syntheticRejection,isReplay,plainInsertPreferences,publicWriteSchema,successfulInitialInsert,SOURCE_SHA,HOST,PATH,MODES,FIELDS};
