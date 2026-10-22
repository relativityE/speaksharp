import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createLlamaRuntime,investigationLlamaLocations,LlamaOutputContractError} from '../../frontend/src/services/coaching/llamaProvider';
import {createCoachingProvider} from '../../frontend/src/services/coaching/provider';

const mocks=vi.hoisted(()=>({counts:[1,1,1],part:0,create:vi.fn(),reset:vi.fn(),interrupt:vi.fn(),unload:vi.fn()}));
vi.mock('@mlc-ai/web-llm',()=>({CreateMLCEngine:vi.fn(async()=>({resetChat:mocks.reset,
  interruptGenerate:mocks.interrupt,unload:mocks.unload,chat:{completions:{create:mocks.create}}}))}));
vi.mock('@huggingface/transformers',()=>({PreTrainedTokenizer:class{
  encode(){return new Array(mocks.counts[mocks.part++%3]).fill(1);}
}}));
const pair={version:'llama_coaching_v1',what_worked:'You named an owner.',what_to_try_next:'State the cost.'};
const response=(usage:unknown,finish='stop',raw=JSON.stringify(pair))=>({
  choices:[{message:{content:raw},finish_reason:finish}],usage});
const runtime=()=>createLlamaRuntime(investigationLlamaLocations('http://127.0.0.1:1'));

describe('pinned legacy SDK usage excludes the separately submitted BOS prefix',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.counts=[1,1,1];mocks.part=0;
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));});
  afterEach(()=>vi.unstubAllGlobals());

  // Six retained inputs, not eighteen independent quality observations. The real
  // SDK serialization/tokenizer evidence is retained separately from this unit stub.
  it.each([['open-specific',436,435],['open-sparse',416,415],['open-untrusted',437,436],
    ['focus-full',612,611],['focus-partial',594,593],['focus-unavailable',580,579]])(
    'compares %s usage with message tokens while preserving full context count',async(_id,context,usage)=>{
      mocks.counts=[Number(usage)-2,1,1];mocks.create.mockResolvedValueOnce(response({prompt_tokens:usage}));
      const model=await runtime();const result=await model.generateCoaching('Retained synthetic evidence.','open_mic');
      expect(result.predictedPromptTokens).toBe(context);
      expect(result.observedPromptTokensMatch).toBe(true);
      await model.dispose();
    });

  it.each([1,2,4,5,undefined,NaN,Infinity,-Infinity,3.5,-1,'3'])(
    'refuses unexplained or invalid usage %s without tolerance',async usage=>{
      mocks.create.mockResolvedValueOnce(response(usage===undefined?undefined:{prompt_tokens:usage}));
      const model=await runtime();expect((await model.generateCoaching('Evidence.','open_mic')).observedPromptTokensMatch).toBe(false);
      await model.dispose();
    });

  it('admits the exact full-context limit including BOS and reserved output',async()=>{
    mocks.counts=[3837,1,1];mocks.create.mockResolvedValueOnce(response({prompt_tokens:3839}));
    const model=await runtime();const result=await model.generateCoaching('Evidence.','open_mic');
    expect(result.predictedPromptTokens).toBe(3840);expect(result.observedPromptTokensMatch).toBe(true);
    expect(mocks.create.mock.calls[0][0].max_tokens).toBe(256);await model.dispose();
  });

  it('refuses one token beyond full context before dispatch, even when SDK usage alone would fit',async()=>{
    mocks.counts=[3838,1,1];const model=await runtime();
    await expect(model.generateCoaching('Evidence.','open_mic')).rejects.toThrow('budget');
    expect(mocks.create).not.toHaveBeenCalled();await model.dispose();
  });

  it('retains invalid output as a contract failure even with explained usage',async()=>{
    mocks.create.mockResolvedValueOnce(response({prompt_tokens:3},'stop','{}'));
    const model=await runtime();await expect(model.generateCoaching('Evidence.','open_mic')).rejects.toBeInstanceOf(LlamaOutputContractError);
    await model.dispose();
  });

  it('the actual product boundary still refuses length termination before commit',async()=>{
    mocks.create.mockResolvedValueOnce(response({prompt_tokens:3},'length'));
    const model=await runtime();
    const invoke=vi.fn(async(body:Record<string,unknown>)=>({error:null,data:{preparation:{
      provider:'llama:3.2-1b',model:'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      modelRevision:'2a37b0a5ecb622d51ddc2fac74de0b95872affd7',generationId:body.generationId,
      contextSha256:'a'.repeat(64),prompt:'Canonical synthetic evidence.',product:'open_mic'}}}));
    const provider=createCoachingProvider({config:{provider:'llama:3.2-1b',acknowledgeNotProductionReady:true},
      internal:true,invoke,ownerId:async()=>'owner',hasDownloadConsent:()=>true,loadLocal:async()=>model});
    const result=await provider.request({sessionId:'synthetic',product:'open_mic'});
    expect(result.error).toMatchObject({message:expect.stringContaining('token budget')});
    expect(invoke.mock.calls.map(([body])=>body.operation)).toEqual(['prepare_local']);
  });
});
