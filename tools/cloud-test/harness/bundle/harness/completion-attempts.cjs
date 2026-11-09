'use strict';
// Pure bounded receipt correlation. This is the guarded HTTP boundary, NOT backend server logs.
const crypto=require('node:crypto');
const {sessionPayloadAuthDigest,isCanonicalSessionUuid}=require('./fault-contract.cjs');
const VIOLATIONS=new Set(['completion-scope-contradiction','extra-or-changed-completion-attempt','completion-session-noncanonical']);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
class CompletionAttempts {
  constructor(f){this.scope=Object.freeze({host:f.host,path:f.path.slice(1,-1),accountSubjectSha256:f.accountSubjectSha256,expectedSessionSha256:f.expectedSessionSha256,mode:f.mode});this.attempts=[];this.retryMarked=false;this.problem=null;}
  fail(reason){if(!VIOLATIONS.has(this.problem))this.problem=reason;}
  matchesRoute({host,method,pathname}){return host===this.scope.host&&method==='POST'&&pathname===this.scope.path;}
  observe(request){
    if(!this.matchesRoute(request))return null;
    let body,subject;
    try{body=JSON.parse(request.bodyBuffer.toString('utf8'));const entries=Object.entries(request.headers||{}).filter(([k])=>k.toLowerCase()==='authorization');if(entries.length!==1)throw Error();const token=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(entries[0][1]);if(!token)throw Error();subject=JSON.parse(Buffer.from(token[1].split('.')[1],'base64url')).sub;if(typeof subject!=='string'||typeof body.p_session_id!=='string')throw Error();}catch{this.fail('completion-identity-unreadable');return{permitted:false,reason:this.problem};}
    if(!isCanonicalSessionUuid(body.p_session_id)){this.fail('completion-session-noncanonical');return{permitted:false,reason:this.problem};}
    // A later deliberately started different take is outside this own-session scope.
    if(sha(body.p_session_id)!==this.scope.expectedSessionSha256)return null;
    if(sha(subject)!==this.scope.accountSubjectSha256||body.p_status!=='completed'){this.fail('completion-scope-contradiction');return{permitted:false,reason:this.problem};}
    const requestBodySha256=sha(request.bodyBuffer),operationDigest=sessionPayloadAuthDigest(this.scope.accountSubjectSha256,body.p_session_id,requestBodySha256),index=this.attempts.length+1;
    const permitted=!this.problem&&(index===1||index===2&&this.retryMarked&&this.attempts[0].requestBodySha256===requestBodySha256);
    const attempt={index,phase:index===1?'initial':this.retryMarked?'explicit-retry-window':'outside-retry-window',requestBodySha256,operationDigest,permitted,outcome:null,status:null,forwarded:false};
    // Keep memory bounded even when unexpected duplicates hit the cumulative cap.
    if(this.attempts.length<4)this.attempts.push(attempt);
    if(!permitted)this.fail('extra-or-changed-completion-attempt');
    return{...attempt,reason:permitted?null:this.problem};
  }
  finish(index,{outcome,status,forwarded}){const a=this.attempts.find(a=>a.index===index);if(!a||a.outcome)return;Object.assign(a,{outcome,status:Number.isInteger(status)?status:null,forwarded:forwarded===true});}
  authorizeRetry(){
    const first=this.attempts[0];
    if(this.problem||this.retryMarked||this.attempts.length!==1||first?.outcome!==('fault-'+this.scope.mode))throw new Error('HARNESS_LIMITED: completion attempt before explicit Retry is missing, extra or unfinished');
    this.retryMarked=true;return true;
  }
  summary(){const a=this.attempts;const exact=!this.problem&&this.retryMarked&&a.length===2&&a[0].outcome==='fault-'+this.scope.mode&&a[1].outcome==='completed'&&a[1].status>=200&&a[1].status<300&&a[1].forwarded&&a[0].requestBodySha256===a[1].requestBodySha256;const violation=VIOLATIONS.has(this.problem);return Object.freeze({status:violation?'VIOLATION':exact?'COMPLETE':'INCOMPLETE',violation,incomplete:!violation&&!exact,evidenceScope:'guarded-outbound-and-HTTP-response-receipts',independentServerReceipts:'UNKNOWN',attemptCount:a.length,retryMarked:this.retryMarked,problem:this.problem,exactExpectedAttempts:exact,attempts:a.map(x=>Object.freeze({...x}))});}

}
module.exports={CompletionAttempts};
