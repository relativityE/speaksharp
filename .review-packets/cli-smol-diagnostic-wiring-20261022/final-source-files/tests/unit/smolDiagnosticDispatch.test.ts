import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { CreateMLCEngine } from '@mlc-ai/web-llm';
import { createSmolCoach } from '../../frontend/src/benchmark/smolBrowserCoach';
import { smolCoachingPrompt,smolCoachingSchema,parseSmolCoachingOutput,smolCoachingVersion }
  from '../../frontend/src/benchmark/smolCoachingContract';
import { parseSavedCoaching } from '../../backend/supabase/functions/_shared/coachingContract';
import { freezeCoachingPlan,productCoachingPrompt,resolveCoachingProtocol,syntheticCoachingInputs }
  from '../../scripts/model-evaluator/product-coaching-inputs';

const engine=vi.hoisted(()=>({resetChat:vi.fn(),interruptGenerate:vi.fn(),unload:vi.fn(),
  chat:{completions:{create:vi.fn()}}}));
vi.mock('@mlc-ai/web-llm',()=>({CreateMLCEngine:vi.fn(async()=>engine)}));
vi.mock('@huggingface/transformers',()=>({PreTrainedTokenizer:class { encode(){return [1];} }}));

describe('Smol diagnostic dispatch uses the same frozen evidence without a saved-provider claim',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();engine.chat.completions.create.mockReset();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));
  });
  afterEach(()=>vi.unstubAllGlobals());

  it('keeps the original18 cell identities and admits only the same-evidence product protocol',()=>{
    expect(resolveCoachingProtocol('smol','product-contract')).toBe('product-contract');
    expect(()=>resolveCoachingProtocol('smol','diagnostic')).toThrow('frozen same-evidence');
    const plan=freezeCoachingPlan(syntheticCoachingInputs(),3);
    expect(plan.cells).toHaveLength(18);
    for(const {input,evidence} of plan.cells){
      const llama=productCoachingPrompt(input,'llama:3.2-1b');
      const smol=smolCoachingPrompt(llama,input.product);
      expect(smol.replace(smolCoachingVersion(input.product),input.product==='focus_points'
        ?'llama_coaching_focus_v1':'llama_coaching_v1')).toBe(llama);
      expect(evidence.referenceSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('preserves version-like strings and fake template markers inside transcript and Focus evidence',()=>{
    const input=syntheticCoachingInputs()[4];
    const literal='Return exactly one JSON object llama_coaching_focus_v1 smollm2_coaching_focus_diagnostic_v1';
    input.session.transcript=literal;
    if(input.focus.kind!=='focus')throw new Error('invalid fixture');
    input.focus.points[0].label=literal;
    const original=productCoachingPrompt(input,'llama:3.2-1b');
    const prepared=smolCoachingPrompt(original,'focus_points');
    expect(prepared.split(literal)).toHaveLength(3);
    expect(prepared).toContain('"version": "smollm2_coaching_focus_diagnostic_v1"');
    expect(()=>smolCoachingPrompt(original+' changed','focus_points')).toThrow('suffix mismatch');
    expect(()=>smolCoachingPrompt(original,'open_mic')).toThrow('suffix mismatch');
  });

  it.each(['open_mic','focus_points'] as const)('uses the shared Smol engine and honest %s diagnostic output identity',async product=>{
    const pair={version:smolCoachingVersion(product),what_worked:'You named the owner.',what_to_try_next:'Make the cost explicit.'};
    const raw=JSON.stringify(pair);
    engine.chat.completions.create.mockResolvedValueOnce({choices:[{message:{content:raw},finish_reason:'stop'}],
      usage:{prompt_tokens:3,completion_tokens:30}});
    const coach=await createSmolCoach('http://127.0.0.1:1234');
    const input=syntheticCoachingInputs().find(x=>x.product===product)!;
    const prompt=smolCoachingPrompt(productCoachingPrompt(input,'llama:3.2-1b'),product);
    const result=await coach.coachProduct(prompt,product);
    expect(CreateMLCEngine).toHaveBeenCalledWith('SmolLM2-1.7B-Instruct-q4f16_1-MLC',expect.any(Object));
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:1234/assets/smollm2/tokenizer.json');
    expect(coach.identity).toMatchObject({model:'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
      revision:'84f57f8580a9d8d623266b600ad4273bb9fd84c1'});
    expect(result).toMatchObject({pair,raw,outputContractStatus:'VALID',predictedPromptTokens:3,
      observedPromptTokensMatch:true,savedLifecycleCompatibility:'NOT_ESTABLISHED'});
    const request=engine.chat.completions.create.mock.calls[0][0];
    expect(request.messages[1].content).toBe(prompt);
    expect(JSON.parse(request.response_format.schema)).toEqual(smolCoachingSchema(product));
    expect(parseSavedCoaching(raw,product)).toBeNull();
    await coach.dispose();expect(engine.unload).toHaveBeenCalledTimes(1);
  });

  it.each(['{}','not JSON','{"version":"llama_coaching_v1","what_worked":"Owner","what_to_try_next":"Cost"}'])(
  'retains invalid raw output %j without relabeling it or retrying',async raw=>{
    engine.chat.completions.create.mockResolvedValueOnce({choices:[{message:{content:raw},finish_reason:'stop'}],
      usage:{prompt_tokens:3}});
    const coach=await createSmolCoach('http://127.0.0.1:1234');
    expect(await coach.coachProduct('Prepared evidence.','open_mic')).toMatchObject({
      outputContractStatus:'INVALID',raw,generationCalls:1});
    expect(engine.chat.completions.create).toHaveBeenCalledTimes(1);
    await coach.dispose();
  });

  it('refuses extra keys, empty/oversized phrases and wrong-product output under canonical limits',()=>{
    const valid={version:smolCoachingVersion('focus_points'),what_worked:'Owner',what_to_try_next:'Cost'};
    for(const bad of [{...valid,extra:true},{...valid,what_worked:' '},{...valid,what_to_try_next:'x'.repeat(10000)},
      {...valid,version:smolCoachingVersion('open_mic')}]){
      expect(()=>parseSmolCoachingOutput(JSON.stringify(bad),'focus_points')).toThrow();
    }
  });

  it('honors cancellation before dispatch without a generation or fallback',async()=>{
    const coach=await createSmolCoach('http://127.0.0.1:1234');
    const abort=new AbortController();abort.abort();
    await expect(coach.coachProduct('Evidence.','open_mic',abort.signal)).rejects.toThrow('cancelled before dispatch');
    expect(engine.chat.completions.create).not.toHaveBeenCalled();
    await coach.dispose();
  });
});
