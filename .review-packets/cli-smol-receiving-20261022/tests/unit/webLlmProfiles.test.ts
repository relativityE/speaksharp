import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL as NodeURL } from 'node:url';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { checkWebLlmTokenBudget,webLlmProfile,webLlmPromptParts,type WebLlmModelKey } from '../../frontend/src/services/coaching/webLlmProfiles';
import { createWebLlmRuntime,LocalLlmOutputContractError } from '../../frontend/src/services/coaching/webLlmRuntime';
import { createSmolRuntime } from '../../frontend/src/services/coaching/smolProvider';
import { createLlamaRuntime } from '../../frontend/src/services/coaching/llamaProvider';

const engine=vi.hoisted(()=>({resetChat:vi.fn(),interruptGenerate:vi.fn(),unload:vi.fn(),
  chat:{completions:{create:vi.fn()}}}));
const createEngine=vi.hoisted(()=>vi.fn(async()=>engine));
vi.mock('@mlc-ai/web-llm',()=>({CreateMLCEngine:createEngine}));
vi.mock('@huggingface/transformers',()=>({PreTrainedTokenizer:class {encode(){return [1];}}}));
const locations={modelBase:'http://127.0.0.1/assets/model/',library:'http://127.0.0.1/assets/runtime.wasm',
  tokenizer:'http://127.0.0.1/assets/tokenizer.json',tokenizerConfig:'http://127.0.0.1/assets/tokenizer_config.json'};
const request={system:'Evidence only.',user:'Speech.',schema:{type:'object'},parse:JSON.parse};

describe('shared WebLLM adapter profiles, with SDK and tokenizer mocked',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();createEngine.mockResolvedValue(engine);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));
  });
  afterEach(()=>vi.unstubAllGlobals());
  it('uses the pinned upstream ChatML separators and no Llama BOS for Smol',()=>{
    const bytes=readFileSync(new NodeURL('../fixtures/model-evaluator/smollm2-mlc-chat-config.json',import.meta.url));
    const config=JSON.parse(bytes.toString());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('b246a0cdcbdc65d546b320c960555f505c4f061af919df9ac7d793895f3d48e5');
    expect(config.conv_template.name).toBe('chatml');
    expect(config.conv_template.system_prefix_token_ids).toBeNull();
    const template=config.conv_template;
    expect(webLlmPromptParts('smollm2:1.7b','S','U')).toEqual([
      template.system_template.replace('{system_message}','S'),
      template.roles.user+template.role_content_sep+'U'+template.seps[0],
      template.roles.assistant+template.role_empty_sep,
    ]);
    expect(webLlmProfile('smollm2:1.7b').systemPrefixTokenIds).toEqual([]);
    expect(webLlmProfile('llama:3.2-1b').systemPrefixTokenIds).toEqual([128000]);
  });
  it('refuses an unknown profile before fetching or initializing a model',async()=>{
    await expect(createWebLlmRuntime('other' as WebLlmModelKey,locations)).rejects.toThrow('unreviewed');
    expect(fetch).not.toHaveBeenCalled();expect(createEngine).not.toHaveBeenCalled();
  });
  it('selects known profiles without the ES2022 Object.hasOwn API',()=>{
    const descriptor=Object.getOwnPropertyDescriptor(Object,'hasOwn');
    if(!descriptor)throw new Error('test needs the original Object.hasOwn descriptor');
    Object.defineProperty(Object,'hasOwn',{...descriptor,value:undefined});
    try {
      expect(webLlmProfile('smollm2:1.7b').model).toBe('SmolLM2-1.7B-Instruct-q4f16_1-MLC');
      for(const key of ['__proto__','constructor','toString','other']) {
        expect(()=>webLlmProfile(key as WebLlmModelKey)).toThrow('unreviewed');
      }
    }finally {Object.defineProperty(Object,'hasOwn',descriptor);}
  });
  it.each([NaN,-1,0,3841])('rejects invalid/over-budget input count %s without truncation',count=>{
    expect(()=>checkWebLlmTokenBudget('smollm2:1.7b',count,256)).toThrow('no truncation');
  });
  it('keeps model identity, revision and prompt-prefix accounting distinct',async()=>{
    engine.chat.completions.create.mockResolvedValue({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:3}});
    const smol=await createSmolRuntime(locations);
    expect(smol.identity).toMatchObject({model:'SmolLM2-1.7B-Instruct-q4f16_1-MLC',revision:'84f57f8580a9d8d623266b600ad4273bb9fd84c1'});
    expect(createEngine).toHaveBeenLastCalledWith(smol.identity.model,expect.objectContaining({appConfig:expect.objectContaining({cacheBackend:'cache'})}));
    expect(await smol.generate(request)).toMatchObject({predictedPromptTokens:3,observedPromptTokensMatch:true,generationCalls:1});
    await smol.dispose();
    engine.chat.completions.create.mockResolvedValue({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:3}});
    const llama=await createLlamaRuntime(locations);
    expect(llama.identity.model).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
    expect(await llama.generate(request)).toMatchObject({predictedPromptTokens:4,observedPromptTokensMatch:true});
    await llama.dispose();
  });
  it('retains rejected Smol output without putting it in the product error message',async()=>{
    engine.chat.completions.create.mockResolvedValue({choices:[{message:{content:'PRIVATE_INVALID'},finish_reason:'stop'}],usage:{prompt_tokens:3}});
    const runtime=await createSmolRuntime(locations);
    const error=await runtime.generate(request).catch((caught:unknown)=>caught);
    expect(error).toBeInstanceOf(LocalLlmOutputContractError);
    expect((error as LocalLlmOutputContractError).evidence).toMatchObject({raw:'PRIVATE_INVALID',generationCalls:1});
    expect(String(error)).not.toContain('PRIVATE_INVALID');
    await runtime.dispose();
  });
  it.each([1,2,4,5,undefined,NaN,Infinity,'3'])('Smol still refuses unexplained or invalid SDK usage %s',async usage=>{
    engine.chat.completions.create.mockResolvedValueOnce({choices:[{message:{content:'{}'},finish_reason:'stop'}],
      usage:usage===undefined?undefined:{prompt_tokens:usage}});
    const runtime=await createSmolRuntime(locations);
    expect(await runtime.generate(request)).toMatchObject({predictedPromptTokens:3,observedPromptTokensMatch:false});
    expect(engine.chat.completions.create).toHaveBeenCalledOnce();await runtime.dispose();
  });
  it('shares cancellation and never dispatches a cancelled request',async()=>{
    const runtime=await createSmolRuntime(locations);
    const controller=new AbortController();controller.abort();
    await expect(runtime.generate(request,controller.signal)).rejects.toThrow('cancelled before dispatch');
    expect(engine.chat.completions.create).not.toHaveBeenCalled();
    await runtime.dispose();
    await expect(runtime.generate(request)).rejects.toThrow('closed');
  });
});
