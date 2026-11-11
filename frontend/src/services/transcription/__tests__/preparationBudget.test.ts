import {describe,it,expect} from 'vitest';
import {privatePreparationBudgetMs} from '../preparationBudget';
import {CANDIDATES} from '../candidateRegistry';
describe('same bounded preparation policy for app and product evaluator',()=>{
  it('preserves the incumbent and mock/non-Private budgets while respecting each candidate\'s declared budget',()=>{
    const incumbent=CANDIDATES['v2:base.en'];
    expect(privatePreparationBudgetMs('private',false,incumbent)).toBe(5000);
    for(const [id,ms] of [['granite:turboctc-q4f16',120000],['parakeet:tdt-v3:int8',300000]] as const){
      expect(privatePreparationBudgetMs('private',false,CANDIDATES[id])).toBe(ms);
      expect(privatePreparationBudgetMs('private',true,CANDIDATES[id])).toBe(5000);
      expect(privatePreparationBudgetMs('native',false,CANDIDATES[id])).toBe(5000);
    }
    // The budget travels with the candidate's DATA, not its engine: a compatible copy keeps it, and a declared value is honoured as is.
    expect(privatePreparationBudgetMs('private',false,{...CANDIDATES['parakeet:tdt-v3:int8'],id:'fourth:compatible'})).toBe(300000);
    const declared={...incumbent,id:'fourth:declared',execution:{...incumbent.execution,preparationBudgetMs:45000}};
    expect(privatePreparationBudgetMs('private',false,declared)).toBe(45000);
    // No engine check remains: a Parakeet-engine candidate WITHOUT data falls back to the service default, which package validation refuses.
    const bare=structuredClone(CANDIDATES['parakeet:tdt-v3:int8'].execution);delete bare.preparationBudgetMs;
    expect(privatePreparationBudgetMs('private',false,{...CANDIDATES['parakeet:tdt-v3:int8'],execution:bare})).toBe(5000);
  });
});
