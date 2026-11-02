'use strict';
// Own-account browser GET only. Mirrors exact source query surfaces, never service-role RPC.
const {validateReadback}=require('../browser-readback.cjs');
const TABLES=Object.freeze({
 sessions:'id,user_id,status,idempotency_key,transcript_state,transcript,created_at,product,total_words,wpm,filler_counts,filler_words,next_action_signal,ai_suggestions,lease_id,recording_fenced_at,recording_fenced_reason,lease_released_at',
 active_recording_lease:'user_id,lease_id,state',
 objective_session:'id,user_id,brief_id,source_session_id,created_at',
 objective_brief:'id,user_id,project_id,event_goal,created_at',
 objective_brief_point:'id,user_id,brief_id,sort_order,label',
 objective_evidence:'id,user_id,session_id,brief_point_id,verdict,detected_at_seconds',
 progress_recommendations:'id,user_id,source_session_id,formula_version,target_metric,target_direction,target_value,target_units,source_metric_value,shown_text',
 progress_recommendation_attempts:'id,user_id,recommendation_id,practice_session_id,lifecycle,outcome,accepted_at,next_comparable_session_id',
 session_progress_evaluations:'session_id,user_id,formula_version,eligible,exclusion_reasons,clarity_raw,filler_count,error_marker_count,wpm,word_count,cohort_key,baseline_session_id,previous_comparable_session_id'
});
function denied(){const e=new Error('owner readback table/column/filter not reviewed');e.code='NOT_RUN';throw e;}
function createOwnerDb(page,c){
 const b=validateReadback(c);
 return {from(table){if(!Object.hasOwn(TABLES,table))denied();const allowed=new Set(TABLES[table].split(','));let columns=['user_id'],exact=false,filters=[['user_id',c.account.id]],orders=[],start=0,end=99,limit=null,single=false;
  const q={select(s,options={}){columns=[...new Set(s.split(',').map(x=>x.trim()).concat('user_id'))];if(columns.some(x=>!allowed.has(x)))denied();exact=options.count==='exact';return q;},eq(k,v){if(!allowed.has(k)||!['string','number','boolean'].includes(typeof v)||String(v).length>200||(k==='user_id'&&v!==c.account.id))denied();filters.push([k,v]);return q;},order(k,o={}){if(!allowed.has(k))denied();orders.push(k+(o.ascending===false?'.desc':'.asc'));return q;},range(a,z){if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(z)||z<a||z-a>=100||a>1000)denied();start=a;end=z;return q;},limit(n){if(!Number.isInteger(n)||n<1||n>100)denied();limit=n;return q;},maybeSingle(){single=true;return execute();},then(ok,bad){return execute().then(ok,bad);}};
  async function execute(){const url=new URL('/rest/v1/'+table,b.origin);url.searchParams.set('select',columns.join(','));for(const [k,v]of filters)url.searchParams.set(k,'eq.'+v);if(orders.length)url.searchParams.set('order',orders.join(','));url.searchParams.set('offset',String(start));url.searchParams.set('limit',String(limit??(end-start+1)));
   // Never export bearer token or auth storage. Returned content stays in oracle memory only.
   return page.evaluate(async p=>{let auth;try{auth=JSON.parse(localStorage.getItem('sb-'+p.projectRef+'-auth-token')||'null');}catch{return {data:null,error:{code:'OWNER_AUTH'}};}
    if(auth?.user?.id!==p.uid||typeof auth?.access_token!=='string')return {data:null,error:{code:'OWNER_AUTH'}};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(p.url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal,headers:{apikey:p.anonKey,Authorization:'Bearer '+auth.access_token,Accept:'application/json',...(p.exact?{Prefer:'count=exact'}:{})}});if(![200,206].includes(r.status))return {data:null,error:{code:'OWNER_READ_HTTP'}};
     const text=await r.text();if(text.length>1048576)return {data:null,error:{code:'OWNER_READ_SIZE'}};let rows;try{rows=JSON.parse(text);}catch{return {data:null,error:{code:'OWNER_READ_JSON'}};}if(!Array.isArray(rows)||rows.length>100||rows.some(x=>!x||x.user_id!==p.uid))return {data:null,error:{code:'OWNER_READ_SCOPE'}};
     const range=r.headers.get('content-range'),total=range&&/\/(\d+)$/.exec(range);const count=total?Number(total[1]):null;
     if(p.single&&rows.length>1)return {data:null,error:{code:'OWNER_READ_AMBIGUOUS'}};return {data:p.single?(rows[0]??null):rows,error:null,count};
    }catch{return {data:null,error:{code:'OWNER_READ_TRANSPORT'}};}finally{clearTimeout(timer);}
   },{url:url.href,projectRef:b.projectRef,anonKey:b.anonKey,uid:c.account.id,exact,single});
  }
  return q;
 }};
}
async function rows(db,table,columns,filters={}){let q=db.from(table).select(columns);for(const [k,v]of Object.entries(filters))q=q.eq(k,v);const r=await q;if(r.error||!Array.isArray(r.data)){const e=new Error('owner '+table+' read unavailable or RLS denied; no privileged fallback');e.code='NOT_RUN';throw e;}return r.data;}
module.exports={createOwnerDb,rows,TABLES};
