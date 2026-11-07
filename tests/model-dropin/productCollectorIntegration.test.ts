// Synthetic DOM/transport controls; no live account, browser or model is used.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { webcrypto } from 'node:crypto';
import type { Page, Response } from 'playwright';
import { attachProductEvidence } from '../../scripts/model-evaluator/product-evidence';
import { elapsedMs } from './comparisonBounds';
import { CANDIDATES, type Candidate } from '../../frontend/src/services/transcription/candidateRegistry';
import { sealModelPackage, candidateFromPackage, productModelMetadata } from '../../frontend/src/services/transcription/modelPackage';
const session = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const source = {head:'a'.repeat(40),tree:'b'.repeat(40),lockSha256:'c'.repeat(64),worktreeSha256:'d'.repeat(64),files:[]};
const api = 'https://api.example.invalid';
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML=''; document.documentElement.removeAttribute('data-runtime-state'); });
async function exercise(attribution: Record<string, unknown>, changes: {savedText?:string; reopenedText?:string; reopenedId?:string;
  authority?: Record<string, unknown> | null; authorityQuery?: string; duplicateAuthority?: boolean; candidate?: Candidate} = {}) {
  vi.stubGlobal('crypto',webcrypto); vi.stubGlobal('__APP_RELEASE__',source.head);
  vi.stubGlobal('__SPEECH_RUNTIME_DEBUG__',()=>({sessionId:session}));
  const candidateId=changes.candidate?.id ?? 'parakeet:tdt-v3:int8';
  vi.stubGlobal('__PRIVATE_CAPTURE_RECEIPT__',()=>({captureId:'fixture-capture',candidateId,active:true}));
  vi.stubGlobal('__PRIVATE_STT_RUNTIME_DEBUG__',{runtime:'wasm-singlethread'});
  document.body.innerHTML='<main data-testid="session-shell" data-session-state="before"><span data-testid="live-interim"></span></main>';
  const page = Object.assign(new EventEmitter(), {evaluate:async <A,R>(fn:(arg:A)=>R,arg:A)=>fn(arg)}) as unknown as Page;
  const collector = await attachProductEvidence(page,{source,candidateId,candidate:changes.candidate,backend:'wasm',journey:'open_mic',fixtureWavSha256:'e'.repeat(64)},api);
  const synthetic = document.createElement('button'); synthetic.dataset.testid = 'mic-start';
  document.body.append(synthetic); synthetic.click();
  document.documentElement.setAttribute('data-runtime-state','RECORDING');
  document.querySelector('main')!.setAttribute('data-session-state','during');
  document.querySelector('span')!.textContent='synthetic interim';
  await new Promise(resolve=>setTimeout(resolve,0));
  document.documentElement.setAttribute('data-runtime-state','STOPPING');
  await new Promise(resolve=>setTimeout(resolve,0));
  (page as unknown as EventEmitter).emit('response',{url:()=>api+'/rest/v1/rpc/complete_session_v2',ok:()=>true,
    request:()=>({method:()=> 'POST',postDataJSON:()=>({p_status:'completed',p_session_id:session,p_final_transcript:'synthetic final'})})} as unknown as Response);
  const timeline = await collector.freezeTake();
  // Synthetic DOM events must never masquerade as actual Start/Stop intent.
  expect(timeline.startClickMs).toBeNull(); expect(timeline.stopClickMs).toBeNull();
  if (changes.authority !== null) (page as unknown as EventEmitter).emit('response', {
    url:()=>api+'/rest/v1/session_attribution_authority?session_id=eq.'+(changes.authorityQuery??session), ok:()=>true,
    request:()=>({method:()=> 'GET'}),json:async()=>changes.duplicateAuthority ? [canonical, canonical] : [{...canonical,...changes.authority}],
  } as unknown as Response);
  (page as unknown as EventEmitter).emit('response',{url:()=>api+'/rest/v1/sessions?id=eq.'+session,ok:()=>true,
    request:()=>({method:()=> 'GET'}),json:async()=>[{id:session,transcript:changes.savedText??'synthetic final',product:'open_mic',...attribution}]} as unknown as Response);
  vi.stubGlobal('location',{pathname:'/progress/'+(changes.reopenedId??session)});
  document.body.innerHTML='<div data-testid="session-detail-transcript"></div>';
  Object.defineProperty(document.querySelector('div'),'innerText',{value:changes.reopenedText??'synthetic final'});
  await collector.observeReopened();
  const result=await collector.finish();
  expect((page as unknown as EventEmitter).listenerCount('response')).toBe(0);
  expect(JSON.stringify(result)).not.toContain('synthetic final');
  expect(JSON.stringify(result)).not.toContain(session);
  return result.productProof;
}
const verified={attribution_status:'verified',engine:'private',engine_version:'private_parakeet:nvidia/parakeet-tdt-0.6b-v3',
  model_name:'nvidia/parakeet-tdt-0.6b-v3',device_type:'browser'};
const canonical={session_id:session,authority_version:'attrib_v1',engine_class:'private',provider:'transformers-js',engine:'private',
  engine_version:verified.engine_version,model_id:verified.model_name,resolved_device:'browser'};
describe('existing passive collector attached to the bounded product journey',()=>{
  it('derives fourth-package authority/save attribution and rejects a stale incumbent projection',async()=>{
    vi.stubGlobal('crypto',webcrypto);const base=CANDIDATES['v2:base.en'];
    const pkg=await sealModelPackage({schemaVersion:1,kind:'speaksharp-model-package',id:'fourth:collector',engine:base.engine,
      execution:{...base.execution,localModelId:'fourth-collector'},runtime:base.runtime,model:{...base.model,device:'wasm'},license:'fixture only',
      assets:{servedFrom:'/models/fourth-collector',files:base.assets.files!.map(f=>({...f,url:'/models/fourth-collector/'+f.path}))}});
    const candidate=candidateFromPackage(pkg,'fixture.json');const metadata=productModelMetadata(candidate);
    const saved={engine:'private',engine_version:metadata.engineVersion,model_name:metadata.modelName,device_type:'browser'};
    const authority={engine_version:metadata.engineVersion,model_id:metadata.modelName};
    expect((await exercise(saved,{candidate,authority})).verdict).toBe('PASS');
    expect((await exercise(saved,{candidate,authority:{...authority,engine_version:'private_v2:whisper-base.en'}})).verdict).toBe('FAIL');
    expect((await exercise({...saved,model_name:'whisper-base.en'},{candidate,authority})).verdict).toBe('FAIL');
  });
  it('samples the trusted capture listener before handler completion, rejecting untrusted intent (unit boundary)',async()=>{
    vi.stubGlobal('crypto',webcrypto); vi.stubGlobal('__APP_RELEASE__',source.head);
    document.documentElement.removeAttribute('data-runtime-state');
    document.body.innerHTML='<main data-testid="session-shell" data-session-state="before"><button data-testid="mic-start">Start</button><button data-testid="recorder-stop">Stop</button></main>';
    const listeners=vi.spyOn(document,'addEventListener');
    const page=Object.assign(new EventEmitter(),{evaluate:async <A,R>(fn:(arg:A)=>R,arg:A)=>fn(arg)}) as unknown as Page;
    const collector=await attachProductEvidence(page,{source,candidateId:'v2:base.en',backend:'wasm',journey:'open_mic',fixtureWavSha256:'e'.repeat(64)},api);
    const registration=listeners.mock.calls.find(([name])=>name==='click')!;
    expect(registration[2]).toBe(true); // capture phase, before product bubble handlers
    const observe=registration[1] as (event: MouseEvent)=>void;
    const start=document.querySelector('[data-testid="mic-start"]')!;
    const stop=document.querySelector('[data-testid="recorder-stop"]')!;
    // jsdom cannot mint isTrusted. These are explicit event-boundary doubles,
    // not claimed browser proof; real synthetic DOM click rejection is below.
    observe({isTrusted:false,target:start} as unknown as MouseEvent);
    observe({isTrusted:true,target:start} as unknown as MouseEvent);
    document.documentElement.setAttribute('data-runtime-state','RECORDING');
    document.querySelector('main')!.setAttribute('data-session-state','during');
    await new Promise(resolve=>setTimeout(resolve,0));
    observe({isTrusted:true,target:stop} as unknown as MouseEvent);
    const completed=performance.now();
    await new Promise(resolve=>setTimeout(resolve,2));
    const helperReturned=performance.now();
    const timeline=await collector.freezeTake(); await collector.finish(); listeners.mockRestore();
    expect(elapsedMs(timeline.startClickMs,timeline.startMs)).not.toBeNull();
    expect(elapsedMs(timeline.stopClickMs,completed)).not.toBeNull();
    expect(elapsedMs(helperReturned,completed)).toBeNull();
  });
  it('passes an exact verified completion/save/reopen chain',async()=>expect((await exercise(verified)).verdict).toBe('PASS'));
  it('holds absent persisted attribution',async()=>expect((await exercise({})).verdict).toBe('HOLD'));
  it.each(['pending','unverified'])('accepts %s legacy status only with canonical authority',async attribution_status=>{
    expect((await exercise({...verified,attribution_status})).verdict).toBe('PASS');
    expect((await exercise({...verified,attribution_status},{authority:null})).verdict).toBe('HOLD');
  });
  it('does not accept a forged legacy verified flag without authority',async()=>expect((await exercise(verified,{authority:null})).verdict).toBe('HOLD'));
  it.each(['session_id','authority_version','engine_class','provider','engine','engine_version','model_id','resolved_device'])(
    'fails wrong canonical %s',async field=>expect((await exercise(verified,{authority:{[field]:'wrong'}})).verdict).toBe('FAIL'));
  it('ignores unrelated authority reads and rejects ambiguous exact-session responses',async()=>{
    expect((await exercise(verified,{authorityQuery:other})).verdict).toBe('HOLD');
    expect((await exercise(verified,{duplicateAuthority:true})).verdict).toBe('FAIL');
  });
  it.each(['engine','engine_version','model_name','device_type'])('fails wrong %s',async field=>
    expect((await exercise({...verified,[field]:'wrong'})).verdict).toBe('FAIL'));
  it('fails save content substitution',async()=>expect((await exercise(verified,{savedText:'substituted'})).verdict).toBe('FAIL'));
  it('fails reopened content substitution',async()=>expect((await exercise(verified,{reopenedText:'substituted'})).verdict).toBe('FAIL'));
  it('fails same-length substitutions, so length diagnostics cannot establish content equality',async()=>{
    expect('synthetic wrong'.length).toBe('synthetic final'.length);
    expect((await exercise(verified,{savedText:'synthetic wrong'})).verdict).toBe('FAIL');
    expect((await exercise(verified,{reopenedText:'synthetic wrong'})).verdict).toBe('FAIL');
  });
  it('fails reopened session substitution',async()=>expect((await exercise(verified,{reopenedId:other})).verdict).toBe('FAIL'));
});
