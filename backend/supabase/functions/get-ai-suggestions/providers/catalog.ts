import coachingContract from '../contract.json' with { type: 'json' };
import { SAFE_MODEL_ID } from './types.ts';

/**
 * DROP-IN DESCRIPTORS — the coaching provider/model as reviewed DATA, the same split the Private STT model updater uses (candidate
 * descriptor = data, engine = installed adapter family). Adding a model of an installed family is a new descriptor; adding a new wire
 * protocol is a reviewed adapter family in registry.ts. Neither is selected at runtime from a request or an environment variable.
 *
 * The descriptor carries no key and no prompt: `keyVariable` is a NAME only, read by the handler. The Gemini model stays pinned by
 * contract.json (its bytes are fixed by the model-currency proof), so the Gemini descriptor reads it rather than restating it.
 */
export const ADAPTER_FAMILIES = ['gemini-generate-content'] as const;
export type AdapterFamily = typeof ADAPTER_FAMILIES[number];

export interface ProviderDescriptor {
  /** The persisted provider id (authority receipt, diagnostics). */
  readonly id: string;
  /** The installed wire protocol that runs this descriptor. */
  readonly family: AdapterFamily;
  /** The model id the request names; logged and persisted, so SAFE_MODEL_ID. */
  readonly model: string;
  /** https endpoint template with exactly one `{model}` placeholder; no credentials, query or fragment. */
  readonly endpoint: string;
  /** The NAME of the environment variable holding this provider's key. */
  readonly keyVariable: string;
}

const ID = /^[a-z][a-z0-9_]{0,63}$/;
const KEY_VARIABLE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FIELDS = ['id', 'family', 'model', 'endpoint', 'keyVariable'];

export class InvalidProviderDescriptorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'InvalidProviderDescriptorError';
  }
}
function refuse(code: string): never {
  throw new InvalidProviderDescriptorError(code);
}

/** Shape validation of one descriptor. A refusal names a closed code only, never the offending value. */
export function parseProviderDescriptor(input: unknown): ProviderDescriptor {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) refuse('DESCRIPTOR_NOT_OBJECT');
  const d = input as Record<string, unknown>;
  if (Object.keys(d).some((k) => !FIELDS.includes(k)) || FIELDS.some((k) => !Object.hasOwn(d, k))) refuse('DESCRIPTOR_FIELDS_INVALID');
  if (typeof d.id !== 'string' || !ID.test(d.id)) refuse('DESCRIPTOR_ID_INVALID');
  if (typeof d.family !== 'string' || !(ADAPTER_FAMILIES as readonly string[]).includes(d.family)) refuse('DESCRIPTOR_FAMILY_UNSUPPORTED');
  if (typeof d.model !== 'string' || !SAFE_MODEL_ID.test(d.model)) refuse('DESCRIPTOR_MODEL_INVALID');
  if (typeof d.keyVariable !== 'string' || !KEY_VARIABLE.test(d.keyVariable)) refuse('DESCRIPTOR_KEY_VARIABLE_INVALID');
  if (typeof d.endpoint !== 'string' || d.endpoint.split('{model}').length !== 2) refuse('DESCRIPTOR_ENDPOINT_INVALID');
  let url: URL;
  try {
    url = new URL(d.endpoint.replace('{model}', d.model));
  } catch {
    refuse('DESCRIPTOR_ENDPOINT_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || d.endpoint.includes('?') || d.endpoint.includes('#')) {
    refuse('DESCRIPTOR_ENDPOINT_INVALID');
  }
  return Object.freeze({ id: d.id, family: d.family as AdapterFamily, model: d.model, endpoint: d.endpoint, keyVariable: d.keyVariable });
}

/** The descriptor's request URL: the endpoint template with its model. */
export function descriptorUrl(descriptor: ProviderDescriptor): string {
  return descriptor.endpoint.replace('{model}', descriptor.model);
}

/** The reviewed catalogue. Gemini is unchanged: same model (contract.json), endpoint and key variable as before this split. */
export const PROVIDER_CATALOG: readonly ProviderDescriptor[] = Object.freeze([
  parseProviderDescriptor({
    id: 'google_gemini',
    family: 'gemini-generate-content',
    model: coachingContract.model,
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    keyVariable: 'GEMINI_API_KEY',
  }),
]);
