import { STT_CONFIG } from '@/config';
import { effectiveCandidate } from './candidateSelection';
import type { Candidate } from './candidateRegistry';

/** A candidate's acquisition+validation+runtime preparation budget is its own execution DATA (preparationBudgetMs), so a new or
 * imported model brings its budget with it and no engine is special-cased here. The service's generic 5 s parameter applies only when
 * the candidate declares none. This policy is shared by ordinary app use and the product-lifecycle evaluator; no build/test flag
 * changes it. Incumbent, mock and non-Private behavior remain unchanged. */
export function privatePreparationBudgetMs(mode:string,isMock:boolean,candidate?:Candidate):number {
    if(mode!=='private'||isMock)return STT_CONFIG.STRATEGY_INIT_TIMEOUT_MS;
    const selected=candidate??effectiveCandidate().candidate;
    return selected.execution.preparationBudgetMs??STT_CONFIG.STRATEGY_INIT_TIMEOUT_MS;
}
