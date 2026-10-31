import {describe,it,expect} from 'vitest';
import {privatePreparationBudgetMs} from '../preparationBudget';
import {CANDIDATES} from '../candidateRegistry';
describe('same bounded preparation policy for app and product evaluator',()=>{
  it('preserves the incumbent and mock/non-Private budgets while respecting pinned candidate acquisition budgets',()=>{
    const incumbent=CANDIDATES['v2:base.en'];
    expect(privatePreparationBudgetMs('private',false,incumbent)).toBe(5000);
    for(const id of ['granite:turboctc-q4f16','parakeet:tdt-v3:int8']){
      expect(privatePreparationBudgetMs('private',false,CANDIDATES[id])).toBe(120000);
      expect(privatePreparationBudgetMs('private',true,CANDIDATES[id])).toBe(5000);
      expect(privatePreparationBudgetMs('native',false,CANDIDATES[id])).toBe(5000);
    }
    expect(privatePreparationBudgetMs('private',false,{...CANDIDATES['parakeet:tdt-v3:int8'],id:'fourth:compatible'})).toBe(120000);
  });
});
