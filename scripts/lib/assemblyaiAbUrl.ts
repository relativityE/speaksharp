/**
 * Pure (side-effect-free) AssemblyAI Universal-Streaming v3 URL builder for the
 * credentialed A/B proof. Extracted so it can be unit-tested with NO network.
 *
 * Why this exists / what the credentialed 2026-06-02 A/B (run 26830845676) proved:
 *  - `prompt` is REJECTED by `universal-streaming-english` with error 3006:
 *    "prompt is only supported with the 'u3-rt-pro' speech_model". So prompt
 *    variants MUST switch the speech model to u3-rt-pro (a pricier tier).
 *  - `keyterms_prompt` must be sent as REPEATED query params, not a single
 *    JSON.stringify(array) value (the prior script used JSON.stringify).
 *  - The remaining failures were error 1008 "Too many concurrent sessions"
 *    (a session-pacing problem in the harness, handled in the run loop, not here).
 *
 * Docs: https://www.assemblyai.com/docs/speech-to-text/universal-streaming
 */
export type AbVariant = 'baseline' | 'keyterms' | 'prompt' | 'prompt_keyterms';

export const AB_DEFAULT_SPEECH_MODEL = 'universal-streaming-english';
/** AssemblyAI accepts the streaming `prompt` parameter ONLY on this model. */
export const AB_PROMPT_SPEECH_MODEL = 'u3-rt-pro';

const usesPrompt = (v: AbVariant): boolean => v === 'prompt' || v === 'prompt_keyterms';
const usesKeyterms = (v: AbVariant): boolean => v === 'keyterms' || v === 'prompt_keyterms';

/** Prompt variants require u3-rt-pro; everything else stays on the baseline model. */
export function speechModelForVariant(variant: AbVariant, baseModel: string = AB_DEFAULT_SPEECH_MODEL): string {
  return usesPrompt(variant) ? AB_PROMPT_SPEECH_MODEL : baseModel;
}

export interface AbUrlOptions {
  variant: AbVariant;
  token: string;
  sampleRateHz: number;
  encoding: string;
  keyterms: string[];
  prompt: string;
  baseModel?: string;
  host?: string;
}

/**
 * Build the v3 streaming WebSocket URL for a given A/B variant.
 * Deterministic and offline — safe to assert against in unit tests.
 */
export function buildAbStreamingUrl(options: AbUrlOptions): string {
  const {
    variant, token, sampleRateHz, encoding, keyterms, prompt,
    baseModel = AB_DEFAULT_SPEECH_MODEL,
    host = 'wss://streaming.assemblyai.com/v3/ws',
  } = options;

  const params = new URLSearchParams({
    sample_rate: String(sampleRateHz),
    encoding,
    speech_model: speechModelForVariant(variant, baseModel),
    format_turns: 'true',
    token,
  });

  // keyterms_prompt: REPEATED query params (one per term), NOT a JSON array string.
  if (usesKeyterms(variant)) {
    for (const term of keyterms) {
      const trimmed = term.trim();
      if (trimmed) params.append('keyterms_prompt', trimmed);
    }
  }

  // prompt: only valid alongside the u3-rt-pro model (enforced by speechModelForVariant).
  if (usesPrompt(variant)) {
    params.set('prompt', prompt);
  }

  return `${host}?${params.toString()}`;
}
