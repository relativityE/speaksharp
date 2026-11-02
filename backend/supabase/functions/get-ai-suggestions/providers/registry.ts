import { type AdapterFamily, PROVIDER_CATALOG, type ProviderDescriptor } from './catalog.ts';
import { createGeminiAdapter } from './gemini.ts';
import type { CoachingProvider } from './types.ts';

/**
 * The provider ids the database can persist today. The authority receipt table's CHECK and `persist_ai_suggestion_with_authority_v1`
 * accept `google_gemini` only; widening that is the tracked follow-on SQL/frontend scope, not this change.
 */
export const PERSISTABLE_PROVIDER_IDS: ReadonlySet<string> = new Set(['google_gemini']);

/**
 * THE reviewed selection. Gemini stays the default; choosing another provider is a reviewed code change and redeploy (as a different
 * Gemini model is a reviewed contract.json change), never a runtime drop-in. It deliberately does not live in contract.json, whose exact
 * key set and bytes are pinned by the model-currency proof and the native coaching evidence profiles.
 */
export const SELECTED_PROVIDER_ID = 'google_gemini';

/** The installed wire protocols. A descriptor of an installed family is data; a new family is reviewed code here. */
export const ADAPTERS: Readonly<Record<AdapterFamily, (descriptor: ProviderDescriptor) => CoachingProvider>> = Object.freeze({
  'gemini-generate-content': createGeminiAdapter,
});

/**
 * Every catalogued descriptor built through its installed family, by id. Refuses (throws at module load, so the function cannot
 * deploy half-built) a duplicate id, a family with no installed adapter, or an adapter that reports a different id or key variable.
 */
export function buildProviders(
  catalog: readonly ProviderDescriptor[],
  adapters: Readonly<Record<string, (descriptor: ProviderDescriptor) => CoachingProvider>> = ADAPTERS,
): Readonly<Record<string, CoachingProvider>> {
  const built: Record<string, CoachingProvider> = {};
  for (const descriptor of catalog) {
    if (Object.hasOwn(built, descriptor.id)) throw new Error(`provider catalogue: duplicate id ${descriptor.id}`);
    if (!Object.hasOwn(adapters, descriptor.family)) throw new Error(`provider catalogue: no installed adapter for ${descriptor.id}`);
    const provider = adapters[descriptor.family](descriptor);
    if (provider.id !== descriptor.id || provider.keyVariable !== descriptor.keyVariable) {
      throw new Error(`provider catalogue: adapter does not match descriptor ${descriptor.id}`);
    }
    built[descriptor.id] = provider;
  }
  return Object.freeze(built);
}

/** Every adapter this build ships, by id. */
export const PROVIDERS: Readonly<Record<string, CoachingProvider>> = buildProviders(PROVIDER_CATALOG);

/**
 * The reviewed selection (SELECTED_PROVIDER_ID) resolved to an adapter, or null. Null — refused by the handler as a configuration
 * failure BEFORE admission, quota or any provider call — when the id is missing or not a string, names no shipped adapter, or names
 * one the database cannot persist. Nothing is selected at runtime from a request or an environment variable.
 */
export function selectProvider(
  configured: unknown,
  providers: Readonly<Record<string, CoachingProvider>> = PROVIDERS,
  persistable: ReadonlySet<string> = PERSISTABLE_PROVIDER_IDS,
): CoachingProvider | null {
  if (typeof configured !== 'string' || !Object.hasOwn(providers, configured) || !persistable.has(configured)) return null;
  const provider = providers[configured];
  return provider.id === configured ? provider : null;
}
