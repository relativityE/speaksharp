import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createLlamaCoach } from '../../frontend/src/benchmark/llamaBrowserCoach';
import { createLlamaRuntime,investigationLlamaLocations,LlamaOutputContractError } from '../../frontend/src/services/coaching/llamaProvider';

const engine=vi.hoisted(()=>({resetChat:vi.fn(),interruptGenerate:vi.fn(),unload:vi.fn(),
  chat:{completions:{create:vi.fn()}}}));
vi.mock('@mlc-ai/web-llm',()=>({CreateMLCEngine:vi.fn(async()=>engine)}));
vi.mock('@huggingface/transformers',()=>({PreTrainedTokenizer:class {
  encode(){return [1];}
}}));

describe('isolated coaching evidence survives canonical output rejection',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));
  });
  afterEach(()=>vi.unstubAllGlobals());
  it.each(['{}','not JSON',''])('retains exact rejected output %j with runtime usage and finish reason',async raw=>{
    engine.chat.completions.create.mockResolvedValueOnce({choices:[{message:{content:raw},finish_reason:'length'}],
      usage:{prompt_tokens:3,completion_tokens:256,total_tokens:259}});
    const coach=await createLlamaCoach('http://127.0.0.1:1');
    const result=await coach.coachProduct('Synthetic evidence.','open_mic');
    expect(result).toMatchObject({outputContractStatus:'INVALID',raw,finishReason:'length',
      usage:{prompt_tokens:3,completion_tokens:256,total_tokens:259},generationCalls:1,
      predictedPromptTokens:4,observedPromptTokensMatch:true,humanUsefulness:'UNREVIEWED'});
    expect('pair' in result).toBe(false);
    expect(engine.chat.completions.create).toHaveBeenCalledTimes(1);
    await coach.dispose();
  });
  it('never attributes an earlier raw output to a later dispatch failure',async()=>{
    engine.chat.completions.create.mockResolvedValueOnce({choices:[{message:{content:'{}'},finish_reason:'stop'}],
      usage:{prompt_tokens:3}}).mockRejectedValueOnce(new Error('GPU dispatch failed'));
    const coach=await createLlamaCoach('http://127.0.0.1:1');
    await coach.coachProduct('First evidence.','open_mic');
    await expect(coach.coachProduct('Second evidence.','open_mic')).rejects.toThrow('GPU dispatch failed');
    await coach.dispose();
  });
  it('retains an absent message as null without inventing raw output or runtime usage',async()=>{
    engine.chat.completions.create.mockResolvedValueOnce({choices:[]});
    const coach=await createLlamaCoach('http://127.0.0.1:1');
    expect(await coach.coachProduct('Evidence.','open_mic')).toMatchObject({
      outputContractStatus:'INVALID',raw:null,observedPromptTokensMatch:false,
    });
    await coach.dispose();
  });
  it('preserves valid canonical output and labels only its contract validity',async()=>{
    const pair={version:'llama_coaching_v1',what_worked:'You named the owner.',what_to_try_next:'State the cost.'};
    engine.chat.completions.create.mockResolvedValueOnce({choices:[{message:{content:JSON.stringify(pair)},finish_reason:'stop'}],
      usage:{prompt_tokens:3,completion_tokens:30}});
    const coach=await createLlamaCoach('http://127.0.0.1:1');
    expect(await coach.coachProduct('Evidence.','open_mic')).toMatchObject({pair,
      outputContractStatus:'VALID',humanUsefulness:'UNREVIEWED',finishReason:'stop'});
    await coach.dispose();
  });
  it('keeps product runtime rejection fail-closed with no raw text in its error message',async()=>{
    engine.chat.completions.create.mockResolvedValueOnce({choices:[{message:{content:'PRIVATE INVALID OUTPUT'},finish_reason:'stop'}]});
    const runtime=await createLlamaRuntime(investigationLlamaLocations('http://127.0.0.1:1'));
    const error=await runtime.generateCoaching('Evidence.','open_mic').catch((error:unknown)=>error);
    expect(error).toBeInstanceOf(LlamaOutputContractError);
    expect(String(error)).not.toContain('PRIVATE INVALID OUTPUT');
    await runtime.dispose();
  });
});
