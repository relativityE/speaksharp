import { CreateMLCEngine } from '@mlc-ai/web-llm';
import { PreTrainedTokenizer } from '@huggingface/transformers';
import { checkWebLlmTokenBudget,webLlmProfile,webLlmPromptParts,type WebLlmModelKey } from './webLlmProfiles';

type LocalLlmResponseEvidence={raw:string|null;usage:unknown;predictedPromptTokens:number;
  observedPromptTokensMatch:boolean;finishReason:string|undefined;generationMs:number;
  generationCalls:number;humanUsefulness:string;cloudBaseline:string};
export class LocalLlmOutputContractError extends Error {
  constructor(readonly evidence:LocalLlmResponseEvidence) {
    super('local coaching failed the output contract');
    this.name='LocalLlmOutputContractError';
  }
}
export interface WebLlmLocations {modelBase:string;library:string;tokenizer:string;tokenizerConfig:string}
/** Caller retains consent, immutable asset verification and worker ownership. */
export async function createWebLlmRuntime(key:WebLlmModelKey,locations:WebLlmLocations) {
  const profile=webLlmProfile(key);
  const started=performance.now();
  const [tokenizerJson,tokenizerConfig]=await Promise.all([
    fetch(locations.tokenizer).then(r=>{if(!r.ok)throw new Error('tokenizer missing');return r.json();}),
    fetch(locations.tokenizerConfig).then(r=>{if(!r.ok)throw new Error('tokenizer config missing');return r.json();}),
  ]);
  const tokenizer=new PreTrainedTokenizer(tokenizerJson,tokenizerConfig);
  const engine=await CreateMLCEngine(profile.model,{
    appConfig:{cacheBackend:'cache',model_list:[{model:locations.modelBase,model_id:profile.model,model_lib:locations.library,
      overrides:{context_window_size:profile.context}}]},logLevel:'WARN',
  });
  let active=false,closed=false,generationCalls=0,generation=0;
  async function generate<T>(request:{system:string;user:string;schema:unknown;parse:(raw:string)=>T},signal?:AbortSignal) {
    if(active||closed)throw new Error('coaching runtime busy or closed');
    if(signal?.aborted)throw new Error('coaching cancelled before dispatch');
    const messageTokens=webLlmPromptParts(key,request.system,request.user)
      .reduce((n,part)=>n+tokenizer.encode(part,{add_special_tokens:false}).length,0);
    const inputTokens=profile.systemPrefixTokenIds.length+messageTokens;
    checkWebLlmTokenBudget(key,inputTokens,profile.maxOutput);
    active=true;
    const own=++generation;
    const abort=()=>{generation++;void engine.interruptGenerate();};
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await engine.resetChat();
      if(signal?.aborted||generation!==own||closed)throw new Error('coaching cancelled before generation');
      const start=performance.now();generationCalls++;
      const response=await engine.chat.completions.create({
        messages:[{role:'system',content:request.system},{role:'user',content:request.user}],
        temperature:0,max_tokens:profile.maxOutput,
        response_format:{type:'json_object',schema:JSON.stringify(request.schema)},
      });
      if(signal?.aborted||generation!==own||closed)throw new Error('coaching cancelled; output retired');
      const raw=response.choices[0]?.message.content;
      const evidence={raw:typeof raw==='string'?raw:null,usage:response.usage,predictedPromptTokens:inputTokens,
        // Pinned WebLLM legacy usage excludes separately submitted prefix IDs;
        // full-context admission above includes them for both model profiles.
        observedPromptTokensMatch:response.usage?.prompt_tokens===messageTokens,
        finishReason:response.choices[0]?.finish_reason,generationMs:performance.now()-start,
        generationCalls,humanUsefulness:'UNREVIEWED',cloudBaseline:'NOT_EXECUTED'};
      if(typeof raw!=='string')throw new LocalLlmOutputContractError(evidence);
      let pair:T;
      try {pair=request.parse(raw);}catch {throw new LocalLlmOutputContractError(evidence);}
      return {...evidence,pair,raw};
    }finally {signal?.removeEventListener('abort',abort);active=false;}
  }
  return {
    identity:{model:profile.model,revision:profile.revision,runtime:'@mlc-ai/web-llm@0.2.86',
      libraryRevision:profile.libraryRevision,context:profile.context},
    acquisition:{startupMs:performance.now()-started,explicitWarmupCalls:0,internalWarmupCalls:'UNKNOWN'},
    counters:()=>({generationCalls}),generate,
    async dispose(){closed=true;generation++;await engine.interruptGenerate();await engine.unload();},
  };
}
