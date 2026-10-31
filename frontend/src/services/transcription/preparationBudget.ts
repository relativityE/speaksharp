import { STT_CONFIG } from '@/config';
import { effectiveCandidate } from './candidateSelection';
import type { Candidate } from './candidateRegistry';

/** Candidate adapters already bound acquisition+validation+runtime preparation to120s.
 * The service's generic5s parameter must not silently replace that contract.
 * This policy is shared by ordinary app use and the product-lifecycle evaluator;
 * no build/test flag changes it. Incumbent and non-Private behavior remain unchanged. */
export function privatePreparationBudgetMs(mode:string,isMock:boolean,candidate?:Candidate):number {
    if(mode!=='private'||isMock)return STT_CONFIG.STRATEGY_INIT_TIMEOUT_MS;
    const selected=candidate??effectiveCandidate().candidate;
    return selected.engine==='granite-ctc'||selected.engine==='parakeet-tdt'
        ?120_000:STT_CONFIG.STRATEGY_INIT_TIMEOUT_MS;
}
