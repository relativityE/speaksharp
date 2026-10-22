import contract from '../../../backend/supabase/functions/get-ai-suggestions/contract.json';
import { parseProviderSuggestions,providerOutputSchema,versionForProvider,type CoachingProduct }
  from '../../../backend/supabase/functions/_shared/coachingContract';

/** Diagnostic labels are deliberately outside the product's saved-provider allowlist. */
export function smolCoachingVersion(product:CoachingProduct):string {
  if(product==='open_mic')return 'smollm2_coaching_diagnostic_v1';
  if(product==='focus_points')return 'smollm2_coaching_focus_diagnostic_v1';
  throw new Error('unknown diagnostic coaching product');
}

/** Change only the trusted final template section, never version-like user evidence. */
export function smolCoachingPrompt(canonicalPrompt:string,product:CoachingProduct):string {
  const version=smolCoachingVersion(product);
  const template=contract.promptTemplate;
  const lastPlaceholder=template.lastIndexOf('}}');
  if(lastPlaceholder<0)throw new Error('canonical coaching template changed');
  const tail=template.slice(lastPlaceholder+2);
  if(!tail.includes(contract.version))throw new Error('canonical coaching version is outside trusted suffix');
  const expected=tail.split(contract.version).join(versionForProvider('llama:3.2-1b',product));
  if(!canonicalPrompt.endsWith(expected))throw new Error('canonical coaching prompt suffix mismatch');
  return canonicalPrompt.slice(0,-expected.length)+tail.split(contract.version).join(version);
}

export function smolCoachingSchema(product:CoachingProduct) {
  const schema=providerOutputSchema('llama:3.2-1b',product);
  return {...schema,properties:{...schema.properties,version:{type:'string',enum:[smolCoachingVersion(product)]}}};
}

export function parseSmolCoachingOutput(raw:string,product:CoachingProduct) {
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('diagnostic coaching must be an object');
  const row=value as Record<string,unknown>;
  const version=smolCoachingVersion(product);
  if(row.version!==version)throw new Error('diagnostic coaching model/product version mismatch');
  // Reuse the product's exact key/string/ceiling checks. The temporary label is
  // only an input to that validator; it is never returned or retained as output.
  const parsed=parseProviderSuggestions(JSON.stringify({...row,version:versionForProvider('llama:3.2-1b',product)}),
    'llama:3.2-1b',product,true);
  if(!parsed)throw new Error('diagnostic coaching failed the canonical shape/length checks');
  return {...parsed,version};
}
