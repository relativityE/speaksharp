// Ported from the harness proof workspace (harness-proof-workspace.zip sha256 9fc02fd68a8d272d61817bcb2fc6fa662b69e11b08c22d3389e78aaf0f9566cd),
// plan-controls/r15-plan-controls.cjs; only the packet binding below changed. Usage: node plan-controls.cjs <campaign-plan.json> > plan-controls.json
const fs=require('fs'),path=require('path'),crypto=require('crypto');
// Packet under test: the vendored harness, or a temp copy named by CT_PROOF_PACKET. The harness bytes are never written.
const bundle=(process.env.CT_PROOF_PACKET||path.resolve(__dirname,'..','..','..','harness'))+'/bundle';const runner=require(bundle+'/harness/campaign-runner.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const planFile=process.argv[2],planBytes=fs.readFileSync(planFile),plan={...JSON.parse(planBytes),consumedPlanSha256:sha(planBytes)};
const out={};
(async()=>{
 const io=runner.createAdapter(plan,bundle,{executeR0:false});
 const attempt=async(label,fn)=>{try{await fn();out[label]='ACCEPTED';}catch(e){out[label]='REFUSED: '+String(e.message).slice(0,170);}};
 await attempt('positive: run identity',()=>io.verifyRunIdentity(plan));
 await attempt('positive: stimulus preflight',()=>io.verifyStimulusPreflight(plan));
 await attempt('positive: every selected case preflight',async()=>{const core=require(bundle+'/harness/campaign-core.cjs');for(const id of core.selectedOrder(plan))await io.preflightCase(plan.cases.find(c=>c.id===id),plan);});
 const dir=fs.mkdtempSync(path.join(path.dirname(planFile),'neg-'));const orig=JSON.parse(fs.readFileSync(plan.stimulusPreflight.file,'utf8'));
 const withReceipt=async(label,mut)=>{const r=JSON.parse(JSON.stringify(orig));mut(r);const f=path.join(dir,label.replace(/\W+/g,'-')+'.json');const b=JSON.stringify(r);fs.writeFileSync(f,b);await attempt('negative: '+label,()=>io.verifyStimulusPreflight({...plan,stimulusPreflight:{file:f,sha256:sha(b)}}));};
 await withReceipt('AHT-12 ungranted request was not denied',r=>{r.cases['AHT-12'].ungrantedOutcome='granted';});
 await withReceipt('AHT-04 capture device not acquired',r=>{r.cases['AHT-04'].captureGranted=false;});
 await withReceipt('AHT-13 media hash differs from the plan',r=>{r.cases['AHT-13'].mediaSha256='d'.repeat(64);});
 await withReceipt('AHT-03 real fixture misaligned',r=>{r.cases['AHT-03'].alignment={status:'misaligned'};});
 await withReceipt('AHT-14 entry missing',r=>{delete r.cases['AHT-14'];});
 await withReceipt('receipt older than 12 hours',r=>{r.createdAt=new Date(Date.now()-13*3600e3).toISOString();});
 await withReceipt('receipt from a different runner code manifest',r=>{r.codeManifestSha256='d'.repeat(64);});
 await withReceipt('receipt records product traffic',r=>{r.productTraffic=2;});
 await attempt('negative: tampered receipt bytes (sha mismatch)',()=>io.verifyStimulusPreflight({...plan,stimulusPreflight:{...plan.stimulusPreflight,sha256:'e'.repeat(64)}}));
 await attempt('negative: runner code manifest in the identity differs',()=>io.verifyRunIdentity({...plan,runIdentity:{...plan.runIdentity,runner:{...plan.runIdentity.runner,codeManifestSha256:'e'.repeat(64)}}}));
 const media=JSON.parse(JSON.stringify(plan));for(const c of media.cases)if(c.id==='AHT-12'){delete c.mediaFile;delete c.mediaSha256;}
 await attempt('negative: AHT-12 plan entry without media',()=>io.preflightCase(media.cases.find(c=>c.id==='AHT-12'),media));
 console.log(JSON.stringify(out,null,1));
})();
