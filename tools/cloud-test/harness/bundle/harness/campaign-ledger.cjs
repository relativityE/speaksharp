'use strict';
// Cumulative pre-send reservations. Local integrity evidence is NOT an OS security boundary.
// The admission receipt must bind creation identity for production; no silent v2 reset/migration.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const safeKey=k=>typeof k==='string'&&/^[a-z][A-Za-z0-9_-]*$/.test(k)&&!['constructor','prototype','__proto__'].includes(k)&&!Object.hasOwn(Object.prototype,k);
function regular(file,max=16777216){const s=fs.lstatSync(file);if(s.isSymbolicLink()||!s.isFile()||s.size>max)throw new Error('ledger integrity: regular bounded file required');return s;}
const stamp=s=>({dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});
const same=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
function syncDir(file){const fd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function exclusive(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(file);}
function readIdentity(file){file=path.resolve(file);regular(file+'.identity',4096);const bytes=fs.readFileSync(file+'.identity'),a=JSON.parse(bytes);if(!plain(a)||!plain(a.caps)||sha(JSON.stringify(Object.entries(a.caps).sort()))!==a.capsSha256||a.version!==1||a.ledgerPath!==file||typeof a.instanceId!=='string'||!/^[0-9a-f-]{36}$/.test(a.instanceId)||!/^[0-9a-f]{64}$/.test(a.capsSha256||''))throw new Error('ledger identity invalid');return{instanceId:a.instanceId,creationAnchorSha256:sha(bytes),capsSha256:a.capsSha256};}
class Ledger{
 constructor(file,caps,options={}){
  if(!plain(caps)||!Object.keys(caps).length||Object.entries(caps).some(([k,v])=>!safeKey(k)||!Number.isSafeInteger(v)||v<0))throw new Error('invalid cap dictionary');
  this.file=path.resolve(file);if(fs.realpathSync(path.dirname(this.file))!==path.dirname(this.file))throw new Error('ledger parent symlink refused');this.caps=Object.freeze({...caps});this.capsSha256=sha(JSON.stringify(Object.entries(caps).sort()));this.lock=this.file+'.lock';this.anchor=this.file+'.identity';this.journal=this.file+'.journal';this.closed=false;
  this.acquireLock();
  try{
   for(const file of [this.file,this.anchor,this.journal]){try{if(fs.lstatSync(file).isSymbolicLink())throw new Error('ledger symlink refused');}catch(e){if(e.code!=='ENOENT')throw e;}}
   const exists=[this.file,this.anchor,this.journal].map(f=>fs.existsSync(f));
   if(exists.some(Boolean)&&!exists.every(Boolean))throw new Error('ledger integrity: deleted or incomplete ledger/identity/journal; schema/caps mismatch or recovery required');
   if(!exists.some(Boolean)){
    if(options.allowCreate===false||options.expectedIdentity)throw new Error('ledger integrity: admitted ledger missing; recreation refused');
    const created=new Date().toISOString(),instanceId=crypto.randomUUID();
    exclusive(this.anchor,JSON.stringify({version:1,ledgerPath:this.file,instanceId,capsSha256:this.capsSha256,caps:this.caps,created}));
    const state={version:3,instanceId,capsSha256:this.capsSha256,used:{},reservations:0,created};const bytes=Buffer.from(JSON.stringify(state,null,2));exclusive(this.file,bytes);
    const identity=readIdentity(this.file),entry={version:1,instanceId,reservations:0,ledgerSha256:sha(bytes),previous:identity.creationAnchorSha256};exclusive(this.journal,JSON.stringify(entry)+'\n');
   }
   this.identity=readIdentity(this.file);if(this.identity.capsSha256!==this.capsSha256)throw new Error('ledger schema/caps mismatch');
   if(options.expectedIdentity&&(options.expectedIdentity.instanceId!==this.identity.instanceId||options.expectedIdentity.creationAnchorSha256!==this.identity.creationAnchorSha256||options.expectedIdentity.capsSha256!==this.identity.capsSha256))throw new Error('ledger creation identity differs from admission');
   this.state=JSON.parse(fs.readFileSync(this.file,'utf8'));this.validateState(this.state);
   this.journalFd=fs.openSync(this.journal,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);
   this.remember();this.assertIntegrity();
  }catch(e){this.release();throw e;}
 }
 // Read-only used-total reader for the budget gate. A freshly initialized ledger legitimately has used:{} and reservations:0, which is ZERO requests.
 // Anything else that is not a coherent admitted ledger (missing file or anchor, wrong shape/version, instance mismatch, total absent after reservations, negative,
 // non-integer, total above reservations) returns null so the caller fails closed; absence is never defaulted to zero.
 static readUsedTotal(file){
  try{
   file=path.resolve(file);regular(file);regular(file+'.identity',4096);
   const state=JSON.parse(fs.readFileSync(file,'utf8')),anchor=JSON.parse(fs.readFileSync(file+'.identity','utf8'));
   if(!plain(state)||!plain(anchor)||state.version!==3||anchor.version!==1||anchor.ledgerPath!==file||typeof state.instanceId!=='string'||state.instanceId!==anchor.instanceId||state.capsSha256!==anchor.capsSha256)return null;
   if(!Number.isSafeInteger(state.reservations)||state.reservations<0||!plain(state.used))return null;
   const entries=Object.entries(state.used);if(entries.some(([k,v])=>!safeKey(k)||!Number.isSafeInteger(v)||v<0||v>state.reservations))return null;
   if(Object.hasOwn(state.used,'total'))return state.used.total;
   return state.reservations===0&&entries.length===0?0:null;
  }catch{return null;}
 }
 static initialize(file,caps){if([file,file+'.identity',file+'.journal',file+'.lock'].some(f=>fs.existsSync(f)))throw new Error('ledger initialization requires fresh path; never reset');const ledger=new Ledger(file,caps,{allowCreate:true});try{return Object.freeze({...ledger.identity});}finally{ledger.release();}}
 static inspectIdentity(file){const identity=readIdentity(file),anchor=JSON.parse(fs.readFileSync(path.resolve(file)+'.identity','utf8'));const ledger=new Ledger(file,anchor.caps,{allowCreate:false,expectedIdentity:identity});try{ledger.assertIntegrity();return Object.freeze({...identity});}finally{ledger.release();}}
 acquireLock(){this.lockToken=crypto.randomBytes(24).toString('hex');try{exclusive(this.lock,JSON.stringify({pid:process.pid,token:this.lockToken}));this.lockStamp=stamp(regular(this.lock,4096));}catch(e){if(e.code==='EEXIST')throw new Error('ledger locked; inspect ownership and retain reservations before separately authorized recovery');throw e;}}
 validateState(s){if(!plain(s)||s.version!==3||s.instanceId!==this.identity.instanceId||s.capsSha256!==this.capsSha256||!Number.isSafeInteger(s.reservations)||s.reservations<0||!plain(s.used)||Object.entries(s.used).some(([k,v])=>!safeKey(k)||!Object.hasOwn(this.caps,k)||!Number.isSafeInteger(v)||v<0||v>this.caps[k]||v>s.reservations))throw new Error('ledger schema/caps mismatch');}
 remember(){this.fileStamp=stamp(regular(this.file));this.anchorStamp=stamp(regular(this.anchor,4096));this.journalStamp=stamp(regular(this.journal));this.fileSha256=sha(fs.readFileSync(this.file));this.journalSha256=sha(fs.readFileSync(this.journal));}
 assertIntegrity(){
  if(this.closed)throw new Error('ledger closed');
  for(const [file,expected,max]of [[this.lock,this.lockStamp,4096],[this.file,this.fileStamp,16777216],[this.anchor,this.anchorStamp,4096],[this.journal,this.journalStamp,16777216]])if(!same(expected,stamp(regular(file,max))))throw new Error('ledger integrity: file deleted, replaced or changed');
  const lock=JSON.parse(fs.readFileSync(this.lock,'utf8'));if(lock.pid!==process.pid||lock.token!==this.lockToken)throw new Error('ledger lock ownership changed');
  if(readIdentity(this.file).creationAnchorSha256!==this.identity.creationAnchorSha256)throw new Error('ledger anchor changed');
  const bytes=fs.readFileSync(this.file),journal=fs.readFileSync(this.journal);if(sha(bytes)!==this.fileSha256||sha(journal)!==this.journalSha256)throw new Error('ledger bytes changed');
  const disk=JSON.parse(bytes);this.validateState(disk);if(JSON.stringify(disk)!==JSON.stringify(this.state))throw new Error('ledger memory/disk mismatch');
  if(!journal.length||journal[journal.length-1]!==10)throw new Error('ledger journal incomplete');
  const lines=journal.toString('utf8').trimEnd().split('\n');let previous=this.identity.creationAnchorSha256,sequence=0,last;
  for(const line of lines){const entry=JSON.parse(line);if(!plain(entry)||entry.version!==1||entry.instanceId!==this.identity.instanceId||entry.previous!==previous||entry.reservations!==sequence||!/^[0-9a-f]{64}$/.test(entry.ledgerSha256||''))throw new Error('ledger journal chain invalid');previous=sha(line);last=entry;sequence++;}
  if(last.reservations!==disk.reservations||last.ledgerSha256!==sha(bytes))throw new Error('ledger/journal commit mismatch; retain evidence for recovery');this.lastJournalHash=previous;
 }
 // Per-case request allowance: counts only 'total' reservations made after it is set. It never raises a cap and never touches the persisted state or caps identity;
 // it only refuses earlier (reason 'case-allowance') so one case cannot consume the allocations protected for later cases and cleanup.
 setCaseAllowance(n){if(!Number.isSafeInteger(n)||n<1)throw new Error('case request allowance must be a positive integer');this.allowance=n;this.allowanceBase=this.state.used.total||0;this.allowanceExhausted=false;}
 caseAllowanceState(){return this.allowance===undefined?null:{allowance:this.allowance,used:(this.state.used.total||0)-this.allowanceBase,exhausted:this.allowanceExhausted===true};}
 tryReserve(keys){
  this.assertIntegrity();if(this.allowance!==undefined&&Array.isArray(keys)&&keys.includes('total')&&(this.state.used.total||0)-this.allowanceBase+1>this.allowance){this.allowanceExhausted=true;return 'case-allowance';}if(!Array.isArray(keys)||!keys.length||keys.some(k=>!safeKey(k)||!Object.hasOwn(this.caps,k)))throw new Error('unknown or empty reservation cap');keys=[...new Set(keys)];
  for(const k of keys)if((this.state.used[k]||0)+1>this.caps[k])return k;
  const next=JSON.parse(JSON.stringify(this.state));for(const k of keys)next.used[k]=(next.used[k]||0)+1;next.reservations++;next.updated=new Date().toISOString();
  const bytes=Buffer.from(JSON.stringify(next,null,2)),entry={version:1,instanceId:this.identity.instanceId,reservations:next.reservations,ledgerSha256:sha(bytes),previous:this.lastJournalHash},line=JSON.stringify(entry)+'\n';
  if(this.journalStamp.size+Buffer.byteLength(line)>16777216)throw new Error('ledger journal limit; stop without resetting');
  const tmp=this.file+'.tmp-'+process.pid+'-'+crypto.randomBytes(8).toString('hex');
  try{exclusive(tmp,bytes);this.assertIntegrity();fs.renameSync(tmp,this.file);syncDir(this.file);fs.writeSync(this.journalFd,line);fs.fsyncSync(this.journalFd);syncDir(this.journal);this.state=next;this.remember();this.assertIntegrity();}catch(e){try{fs.unlinkSync(tmp);}catch{}throw e;}
  return null;
 }
 release(){if(this.closed)return;this.closed=true;if(this.journalFd!==undefined){try{fs.closeSync(this.journalFd);}catch{}this.journalFd=undefined;}try{if(this.lockStamp&&same(this.lockStamp,stamp(regular(this.lock,4096)))){const lock=JSON.parse(fs.readFileSync(this.lock,'utf8'));if(lock.pid===process.pid&&lock.token===this.lockToken){fs.unlinkSync(this.lock);syncDir(this.lock);}}}catch{}}
}
module.exports={Ledger,plain,safeKey};
