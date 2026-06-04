/**
 * ============================================================================
 * NATIVE GEMINI FORMATTER ADAPTER (trusted, server-side, Native-only)
 * ============================================================================
 *
 * The trusted punctuation/casing restoration formatter for the Native engine,
 * wired through the existing `registerNativeTranscriptFormatter` seam. It restores
 * sentence boundaries + casing on the SAVED Native transcript only — never live
 * partials, never Private.
 *
 * WHY GEMINI (server-side) IS ACCEPTABLE FOR NATIVE:
 * Native is already NOT on-device — Chrome Web Speech sends audio to Google. So
 * sending the transcript TEXT to our existing Gemini Edge Function (the same vetted
 * provider relationship behind `get-ai-suggestions`) does not weaken a privacy
 * promise the way it would for Private. Private MUST stay local and must never call
 * this adapter (enforced by `assertNotPrivateMode`).
 *
 * SAFETY: the seam's `formatNativeTranscript` wraps this with a word-preservation
 * guard — if Gemini adds/removes/reorders/"corrects" words (or drops a filler), the
 * output is rejected and the raw transcript is kept. This adapter only needs to ask
 * for punctuation/casing restoration; the guard enforces it.
 *
 * DEPLOYMENT: requires a `format-transcript` Supabase Edge Function (mirrors
 * `get-ai-suggestions`). Until deployed, invoke() errors -> seam falls back to raw
 * (no regression). Edge function contract: body `{ transcript }` -> `{ formatted }`.
 */
import { getSupabaseClient } from '../../../lib/supabaseClient';
import logger from '../../../lib/logger';
import {
  registerNativeTranscriptFormatter,
  reportNativeFormatterProviderMeta,
  type NativeTranscriptFormatter,
} from './nativeTranscriptFormatter';

export const FORMAT_TRANSCRIPT_EDGE_FUNCTION = 'format-transcript';

/** Shape of the metadata block returned by the format-transcript edge function. */
interface FormatTranscriptMetadata {
  provider?: string;
  model?: string;
  inputChars?: number;
  outputChars?: number;
  latencyMs?: number;
  wordPreservingServerCheck?: boolean;
  formatterVersion?: string;
  requestId?: string;
}

/**
 * Best-effort extraction of the stable error `code` AND upstream `providerStatus`
 * from a Supabase FunctionsHttpError (its `.context` is the raw Response with our
 * { error, code, metadata:{ providerStatus } } body). Never throws. Surfacing the
 * SPECIFIC code (e.g. FORMATTER_PROVIDER_ERROR) + the Gemini HTTP status is what
 * lets a proof diagnose a 502 instead of a collapsed generic FORMATTER_ERROR.
 */
async function extractEdgeError(error: unknown): Promise<{ code: string | null; providerStatus: number | null }> {
  try {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx && typeof (ctx as Response).clone === 'function') {
      const body = await (ctx as Response).clone().json().catch(() => null) as
        | { code?: unknown; metadata?: { providerStatus?: unknown } }
        | null;
      const code = typeof body?.code === 'string' ? body.code : null;
      const providerStatus = typeof body?.metadata?.providerStatus === 'number'
        ? body.metadata.providerStatus
        : null;
      return { code, providerStatus };
    }
  } catch {
    /* ignore — telemetry is best-effort */
  }
  return { code: null, providerStatus: null };
}

/**
 * The strict instruction the edge function applies. Exported so the (separately
 * deployed) edge function and tests share one source of truth.
 */
export const NATIVE_FORMATTER_INSTRUCTION = [
  'Restore sentence punctuation and fix capitalization (true-casing).',
  'Capitalize the first word of each sentence, proper nouns, and the word "I".',
  'LOWERCASE any other word that is capitalized in the middle of a sentence and is not a proper noun.',
  'Do NOT add, remove, reorder, summarize, translate, or correct any words; change punctuation and letter case only.',
  'Preserve filler words exactly as spoken: um, uh, like, you know, basically, literally.',
  'Return only the reformatted transcript text.',
].join(' ');

/**
 * Build the Native formatter that calls the Gemini `format-transcript` edge fn.
 * Returns the raw input on any error/empty response — the seam's guard provides
 * the word-preservation backstop on top of this.
 */
export function createGeminiNativeFormatter(): NativeTranscriptFormatter {
  return async (raw: string): Promise<string> => {
    const text = raw ?? '';
    if (!text.trim()) return text;

    reportNativeFormatterProviderMeta({
      provider: 'gemini',
      functionName: FORMAT_TRANSCRIPT_EDGE_FUNCTION,
      inputChars: text.length,
    });

    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.warn('[NativeGeminiFormatter] Supabase client unavailable; returning raw transcript');
      reportNativeFormatterProviderMeta({ errorCode: 'SUPABASE_UNAVAILABLE' });
      return text;
    }

    const { data, error } = await supabase.functions.invoke(FORMAT_TRANSCRIPT_EDGE_FUNCTION, {
      body: { transcript: text, instruction: NATIVE_FORMATTER_INSTRUCTION, engine: 'native' },
    });
    if (error) {
      const { code, providerStatus } = await extractEdgeError(error);
      reportNativeFormatterProviderMeta({
        errorCode: code ?? 'FUNCTION_HTTP_ERROR',
        providerStatus,
      });
      throw error; // bubble to formatNativeTranscript -> falls back to raw
    }
    if (data && typeof (data as { error?: string }).error === 'string') {
      reportNativeFormatterProviderMeta({
        errorCode: (data as { code?: string }).code ?? 'FORMATTER_ERROR',
      });
      throw new Error((data as { error: string }).error);
    }

    const meta = (data as { metadata?: FormatTranscriptMetadata })?.metadata;
    if (meta) {
      reportNativeFormatterProviderMeta({
        provider: meta.provider ?? 'gemini',
        formatterVersion: meta.formatterVersion ?? null,
        requestId: meta.requestId ?? null,
        latencyMs: typeof meta.latencyMs === 'number' ? meta.latencyMs : null,
        inputChars: typeof meta.inputChars === 'number' ? meta.inputChars : text.length,
        outputChars: typeof meta.outputChars === 'number' ? meta.outputChars : null,
        serverWordPreserving:
          typeof meta.wordPreservingServerCheck === 'boolean' ? meta.wordPreservingServerCheck : null,
      });
    }

    const formatted = (data as { formatted?: unknown })?.formatted;
    return typeof formatted === 'string' && formatted.trim().length > 0 ? formatted : text;
  };
}

/**
 * Hard guard: the Native formatter must NEVER be registered for Private mode.
 * Private is the local/privacy path and must not send transcript text off-device.
 */
export function assertNotPrivateMode(mode: string | undefined): void {
  if (mode === 'private') {
    throw new Error('[NativeGeminiFormatter] Refusing to register Native formatter for Private mode (privacy guard).');
  }
}

/**
 * Register the Gemini Native formatter for production, Native mode only.
 * No-op-safe: pass the active STT mode; throws if called for Private.
 * Returns the previously-registered formatter (for restore in tests).
 */
export function registerNativeProductionFormatter(
  mode: string | undefined,
): NativeTranscriptFormatter | null {
  assertNotPrivateMode(mode);
  if (mode !== 'native') {
    logger.info({ mode }, '[NativeGeminiFormatter] Skipping registration for non-Native mode');
    return null;
  }
  return registerNativeTranscriptFormatter(createGeminiNativeFormatter());
}
