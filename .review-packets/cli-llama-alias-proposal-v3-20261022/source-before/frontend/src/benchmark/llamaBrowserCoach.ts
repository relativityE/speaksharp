import { createLlamaRuntime,investigationLlamaLocations,LlamaOutputContractError } from '../services/coaching/llamaProvider';
import { coachingPrompt,COACHING_SCHEMA,parseCoachingOutput } from './modelInvestigationContracts';
import type { CoachingProduct } from '../../../backend/supabase/functions/_shared/coachingContract';

/** Synthetic protocol wrapper; inference itself is the product's single Llama runtime adapter. */
export async function createLlamaCoach(origin:string) {
  const runtime=await createLlamaRuntime(investigationLlamaLocations(origin));
  async function retain<T>(run:()=>Promise<T>) {
    try {return {...await run(),outputContractStatus:'VALID' as const};}
    catch(error) {
      if(!(error instanceof LlamaOutputContractError)) throw error;
      return {...error.evidence,outputContractStatus:'INVALID' as const,contractError:error.message};
    }
  }
  return {...runtime,async coach(transcript:string,diagnosticTopics:string[]=[],signal?:AbortSignal) {
    const {system,user}=coachingPrompt(transcript,diagnosticTopics);
    const result=await retain(()=>runtime.generate({system,user,schema:COACHING_SCHEMA,parse:parseCoachingOutput},signal));
    return {...result,productContractCompatibility:'NOT_ESTABLISHED',savedFocusEvidence:'NOT_SUPPLIED'};
  },async coachProduct(prompt:string,product:CoachingProduct,signal?:AbortSignal) {
    const result=await retain(()=>runtime.generateCoaching(prompt,product,signal));
    return {...result,productContractCompatibility:'CANONICAL_PROMPT_AND_OUTPUT_ONLY',
      savedLifecycleCompatibility:'NOT_ESTABLISHED',humanUsefulness:'UNREVIEWED'};
  }};
}
