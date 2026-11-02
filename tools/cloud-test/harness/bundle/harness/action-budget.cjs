'use strict';
// Per-case pre-effect reservations. Counts attempted Start presses and session-create RPCs, not saved rows.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
class ActionBudget {
 constructor({runDir,caseId,startPressCap,takeCap}){
  if(!/^AHT-(?:0[1-9]|1[0-5])$/.test(caseId)||![startPressCap,takeCap].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('NOT_RUN: explicit approved per-case Start/take caps required');
  this.file=path.join(path.resolve(runDir),'action-reservations.jsonl');this.caseId=caseId;this.limits={startPresses:startPressCap,takeAttempts:takeCap};this.used={startPresses:0,takeAttempts:0};this.exceeded=null;
  const fd=fs.openSync(this.file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({kind:'case-action-budget',caseId,limits:this.limits})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}this.remember();
 }
 remember(){const s=fs.lstatSync(this.file);this.identity={dev:s.dev,ino:s.ino};this.digest=sha(fs.readFileSync(this.file));}
 verify(){const s=fs.lstatSync(this.file);if(s.isSymbolicLink()||!s.isFile()||s.dev!==this.identity.dev||s.ino!==this.identity.ino||sha(fs.readFileSync(this.file))!==this.digest)throw new Error('action reservation journal changed; no reset');}
 reserve(kind,control){this.verify();const key=kind==='start'?'startPresses':'takeAttempts';if(this.used[key]>=this.limits[key]){this.exceeded=key;const e=new Error(key==='startPresses'?'start-press-cap-exhausted':'take-cap-exhausted');e.code=key==='startPresses'?'START_PRESS_CAP':'TAKE_CAP';e.trustedBlocker=e.message;throw e;}
  const entry={kind,ordinal:this.used[key]+1,control,caseId:this.caseId};const fd=fs.openSync(this.file,'a');try{fs.writeFileSync(fd,JSON.stringify(entry)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}this.used[key]++;this.remember();return Object.freeze({...this.used});
 }
 reserveStart({caseId,control}){if(caseId!==this.caseId||typeof control!=='string'||!new Set(['mic-start','mic-download','mic-retry','verdict-practice-again','focus-points-retry']).has(control))throw new Error('unreviewed Start control or case identity');return this.reserve('start',control);}
 reserveTake(){return this.reserve('take','create_session_and_update_usage');}
 summary(){this.verify();return {caseId:this.caseId,limits:{...this.limits},used:{...this.used},exceeded:this.exceeded,contentSafe:true,reservationEvidence:'action-reservations.jsonl',reservationSha256:this.digest,meaning:'Pre-effect attempted presses and create RPCs, never saved-row/provider-attempt counts'};}
}
module.exports={ActionBudget};
