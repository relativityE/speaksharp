import { geminiProvider } from './gemini.ts';
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

/** Every adapter this build ships, by id. */
export const PROVIDERS: Readonly<Record<string, CoachingProvider>> = Object.freeze({ [geminiProvider.id]: geminiProvider });

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
