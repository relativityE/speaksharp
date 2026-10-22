import { createMoonshineWeb } from './moonshineWeb';
import { createLlamaCoach } from './llamaBrowserCoach';
import type { CoachingProduct } from '../../../backend/supabase/functions/_shared/coachingContract';

if(import.meta.env.VITE_INTERNAL_BUILD!=='true' || !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
  throw new Error('model investigation requires an explicit internal loopback build');
}
let moonshine:Awaited<ReturnType<typeof createMoonshineWeb>>|null=null;
let llama:Awaited<ReturnType<typeof createLlamaCoach>>|null=null;
let gpuSubmissions=0;
const queueClass=(globalThis as unknown as {GPUQueue?:{prototype:{submit:(commands:Iterable<unknown>)=>void}}}).GPUQueue;
if(queueClass) {
  const submit=queueClass.prototype.submit;
  queueClass.prototype.submit=function(commandBuffers){ gpuSubmissions+=1; return submit.call(this,commandBuffers); };
}
const api={
  async initialize(kind:'moonshine'|'llama'){
    await api.dispose();
    if(kind==='moonshine') { moonshine=await createMoonshineWeb(location.origin); return {identity:moonshine.identity,acquisition:moonshine.acquisition}; }
    if(kind==='llama') { llama=await createLlamaCoach(location.origin); return {identity:llama.identity,acquisition:llama.acquisition}; }
    throw new Error('unknown local model');
  },
  async decode(samples:number[]){
    if(!moonshine) throw new Error('Moonshine not initialized');
    const before=gpuSubmissions;
    const result=await moonshine.decode(new Float32Array(samples));
    return {...result,gpuSubmissionDelta:gpuSubmissions-before};
  },
  async coach(transcript:string,diagnosticTopics:string[]=[]){
    if(!llama) throw new Error('Llama not initialized');
    const before=gpuSubmissions;
    const result=await llama.coach(transcript,diagnosticTopics);
    return {...result,gpuSubmissionDelta:gpuSubmissions-before};
  },
  async coachProduct(prompt:string,product:CoachingProduct){
    if(!llama) throw new Error('Llama not initialized');
    const before=gpuSubmissions;
    const result=await llama.coachProduct(prompt,product);
    return {...result,gpuSubmissionDelta:gpuSubmissions-before};
  },
  async dispose(){
    await moonshine?.dispose(); moonshine=null;
    await llama?.dispose(); llama=null;
  },
  snapshot:()=>({moonshine:moonshine?.counters()??null,llama:llama?.counters()??null,gpuSubmissions}),
};
declare global { interface Window { __MODEL_INVESTIGATION__?:typeof api; } }
window.__MODEL_INVESTIGATION__=api;
