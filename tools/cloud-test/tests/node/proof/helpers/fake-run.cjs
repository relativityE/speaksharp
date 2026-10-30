'use strict';
// Ported from the harness proof workspace (harness-proof-workspace.zip sha256 9fc02fd68a8d272d61817bcb2fc6fa662b69e11b08c22d3389e78aaf0f9566cd), tests/helpers/fake-run.cjs; only the path, pin and browser bindings below changed.
// Shared fake-run harness for the r14 controls: the real driver control flow, contract rows, recorder and policies run; only browser-facing modules are stubbed.
const fs=require('node:fs'),Module=require('node:module');
const S=null;
// Packet under test: the vendored harness, or a temp copy named by CT_PROOF_PACKET (mutation controls). The harness bytes are never written.
const P=process.env.CT_PROOF_PACKET||require('node:path').resolve(__dirname,'..','..','..','..','harness');
// Placeholder case configs (scripts/proof_prep_cases.py): a dummy account id and key, NOT A RUN.
const PRIV=process.env.CT_PROOF_CASES_DIR;if(!PRIV)throw new Error('CT_PROOF_CASES_DIR (placeholder case configs) is required');
// The pin is the packet's own reviewed source SHA, never a literal from another harness version.
const PIN=JSON.parse(fs.readFileSync(P+'/draft-adapters/SOURCE.sha256.json','utf8')).sourceSha;
const cfgOf=id=>({...JSON.parse(fs.readFileSync(PRIV+'/cases/'+id+'.json','utf8')),sourceSha:PIN,servedSha:PIN});
const MIN_NEEDS={'AHT-01':[2,2],'AHT-02':[1,1],'AHT-03':[1,1],'AHT-04':[0,1],'AHT-05':[1,1],'AHT-06':[1,1],'AHT-07':[1,1],'AHT-08':[0,0],'AHT-09':[1,1],'AHT-10':[1,1],'AHT-11':[1,3],'AHT-12':[0,1],'AHT-13':[0,1],'AHT-14':[0,1],'AHT-15':[0,0]};
const minCfg=id=>({...cfgOf(id),sampleMode:'minimal',takeCap:MIN_NEEDS[id][0],startPressCap:MIN_NEEDS[id][1]});
function anyChain(over={}){const c={isVisible:async()=>true,count:async()=>0,innerText:async()=>'Your words are still here. Retry to save.',getAttribute:async()=>'full_save',evaluateAll:async()=>true,waitFor:async()=>{},click:async()=>{},fill:async()=>{},selectOption:async()=>{},first(){return c;},filter(){return c;},or(){return c;},nth(){return c;},...over};return c;}
function fake(caseId,o={}){
 let FINAL=()=>[];
 const real=id=>require(P+'/draft-adapters/'+id);const counts={start:0,primary:0,take:0,repeat:0,pressStart:0,resume:0,retryRun:0,finalize:0,products:0};
 let saved=false,micRecording=false,leftSaved=false,stopped=false;const closed=new WeakSet();
 const row=()=>({id:'t1',status:'completed',hasIdempotencyKey:true,transcriptState:'available',transcriptLength:9,transcriptSha256:'abcdef12'});
 const mkPage=()=>{const handlers=new Map();const p={handlers,_mic:{recording:false,recorderVisible:false,liveTracks:0,acquisitions:0,log:[],documentToken:'tok'},setDefaultTimeout(){},setDefaultNavigationTimeout(){},on(n,f){handlers.set(n,f);},off(){},once(){},waitForTimeout:async()=>{},waitForFunction:async(...a)=>o.waitForFunction?o.waitForFunction(...a):true,waitForURL:async()=>{},isClosed:()=>closed.has(p),close:async()=>{closed.add(p);micRecording=false;},goto:async()=>{},url:()=>'https://speaksharp-public.vercel.app/session',getByTestId:id=>{const m=/^focus-point-(\d+)$/.exec(String(id));return m?anyChain({getAttribute:async()=>FINAL()[Number(m[1])]}):anyChain();},getByText:()=>anyChain(),locator:()=>anyChain()};return p;};
 const pageA=mkPage();
 const ui={...real('browser-actions.cjs'),login:async()=>true,openMic:async()=>{},setupFocus:async(p,c,x,cb)=>{if(cb)await cb();},closeFocus:async()=>{},start:async()=>{counts.start++;micRecording=true;pageA._mic.recording=true;pageA._mic.liveTracks=1;},stop:async()=>{stopped=true;micRecording=false;pageA._mic.recording=false;pageA._mic.liveTracks=0;},saved:async()=>{saved=true;if(o.coaching){const q={method:()=>'POST',url:()=>'https://speaksharp-public.vercel.app/functions/v1/get-ai-suggestions',postDataJSON:()=>({sessionId:'t1',client_attempt:0}),timing:()=>({responseEnd:o.coaching.responseEnd??30039})};const rsp={request:()=>q,status:()=>o.coaching.status,headers:()=>({'content-type':o.coaching.contentType||'application/json',...(o.coaching.deny?{'x-ss-harness-deny':'cap:case-allowance'}:{})}),text:async()=>o.coaching.body??''};pageA.handlers.get('request')?.(q);pageA.handlers.get('response')?.(rsp);}return 't1';},take:async()=>{counts.take++;saved=true;return 't'+counts.take;},repeat:async()=>{counts.repeat++;return 'tr';},primary:async()=>{counts.primary++;},pressStart:async()=>{counts.pressStart++;},recording:async()=>{},speak:async()=>{},visible:async()=>true,attr:async()=>'private',products:async()=>{counts.products++;if(caseId==='AHT-09'){const h=pageA.handlers.get('dialog');if(h)h({type:()=>'confirm',message:()=>'A recording is still active. Stop and save this session before leaving?',accept:async()=>{},dismiss:async()=>{}});pageA._mic.recording=false;pageA._mic.liveTracks=0;leftSaved=true;}},closeFocus:async()=>{},reopen:async()=>({before:'abcdef12',after:'abcdef12'}),bindStartPressRecorder(){},controlTrace:async()=>null,currentStage:()=>'unit',safeErrorSummary:()=>({name:'Error'}),signout:async()=>{},sessionCleared:async()=>true};
 Object.assign(ui,o.ui||{});
 const rowsFn=()=>{if(caseId==='AHT-05')return saved&&o.retried?[row()]:[];if(caseId==='AHT-06')return stopped||saved?[row()]:[];if(caseId==='AHT-09')return leftSaved||saved?[row()]:[];return saved?[row()]:[];};
 const micOf=p=>p._mic;
 const stubs={'./browser-actions.cjs':ui,'./browser-readback.cjs':{...real('browser-readback.cjs'),validateReadback(){},sessions:async()=>rowsFn()},
  './browser-observers.cjs':{...real('browser-observers.cjs'),install:async()=>{},mic:async p=>{const m=micOf(p||pageA);if(caseId==='AHT-12'&&counts.primary>0){return {...m,log:[{id:0,outcome:'NotAllowedError'}],acquisitions:1};}return m;},armStates:async()=>{},states:async()=>['loading','error'],...(o.observer||{})},
  './navigation-controls.cjs':{...real('navigation-controls.cjs'),ready:async()=>{}},
  './save-fault-binding.cjs':{...real('save-fault-binding.cjs'),preflight(){},begin:()=>({detach(){}}),bindAndArm:async()=>({faultId:'f1',sessionId:'t1'}),authorizeRetry(){},verifyRetrySave:async()=>{o.retried=true;return {durableSaved:true,savedRowCount:1};},verifyCompletionAttempts:()=>({exactExpectedAttempts:true,attemptCount:2})},
  './feedback-retry-controls.cjs':{...real('feedback-retry-controls.cjs'),preflight(){},run:async()=>{counts.retryRun++;},armFinal(){},finalize:async()=>{counts.finalize++;}},
  './repeat-probes.cjs':{...real('repeat-probes.cjs'),pendingSameSet:async()=>true,beginRapidRepeat:()=>({}),rapidRepeat:async()=>[],cancelRapidWindow:async()=>{},nextStart:async()=>[]},
  './presentation-controls.cjs':{...real('presentation-controls.cjs'),openMicReview:async()=>real('presentation-controls.cjs').OPEN_ROWS.map(id=>({id,result:'PASS',facts:{}})),...(o.presentation||{})},...(o.extraStubs||{})};
 const orig=Module._load;Module._load=function(req,parent,...r){if(parent&&/rev6-r15-prep\/draft-adapters\/source-adapters\.cjs$/.test(parent.filename)&&stubs[req])return stubs[req];return orig.call(this,req,parent,...r);};
 delete require.cache[require.resolve(P+'/draft-adapters/source-adapters.cjs')];let mod;try{mod=require(P+'/draft-adapters/source-adapters.cjs');}finally{Module._load=orig;}
 const c={...minCfg(caseId),...(o.cfg||{})};FINAL=()=>c.focus?.expectedFinal||[];const recorded=[],evidence=[];let n=0;
 const oracle=r=>async a=>a.phase==='assert'||a.phase==='numeric'?{result:'PASS',contentSafe:true,evidenceRefs:['unit.json'],observed:true,...r}:{observed:true};
 const oracles={coaching:oracle({}),pdfOwnerTake:oracle({}),sameTarget:oracle({}),feedbackReceived:oracle({}),feedbackAssociation:oracle(o.association||{}),coachingAssociation:oracle({}),focusEvidence:oracle({}),abandonmentLease:oracle({}),takeoverLease:oracle({})};
 const cap={credentials:{email:'a@b.c',password:'x'},writeEvidence:async(name,v)=>{evidence.push({name,v});return 'e'+(++n)+'.json';},recordAssertion:async a=>{recorded.push(a);},recordStartPress:async()=>{},oracles};
 const pagesCreated=[pageA];let first=true;const context={newPage:async()=>{if(first){first=false;return pageA;}const p=mkPage();pagesCreated.push(p);return p;},grantPermissions:async()=>{},clearPermissions:async()=>{}};
 const guard=o.guard||{armDownloadFault:()=> 'dl1',resumeDownloadNetwork:async()=>{counts.resume++;},summary:()=>({faults:[{id:'f1',fired:true}],downloadFaults:[{id:'dl1',fired:true,bytesForwarded:5,browserOfflineApplied:true}]})};
 const browser={newContext:async()=>({newPage:async()=>{const p=mkPage();pagesCreated.push(p);return p;},close:async()=>{}})};
 return mod.run(caseId,{context,browser,guard,caseConfig:c,capabilities:cap}).then(res=>({res,counts,evidence,config:c,recorded}));
}
module.exports={fake,anyChain,minCfg,cfgOf,P,S,PRIV,MIN_NEEDS};
