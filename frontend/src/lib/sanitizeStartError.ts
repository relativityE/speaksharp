/**
 * Sanitizes an engine-start "leaf" error for Sentry CONTEXT only — never for user-facing copy.
 *
 * Why: when recording start fails, the app-layer Sentry capture (useSessionLifecycle) previously saw
 * only the generic wrapper `TRANSCRIPTION_START_DID_NOT_RECORD:FAILED`, losing the real root cause
 * (e.g. `Unable to load a worklet's module.`). The controller now attaches the leaf as the wrapper's
 * `cause`; this helper produces a redacted, bounded representation for a Sentry context/tag so the leaf
 * is searchable without info-level trace archaeology.
 *
 * PII posture (mirrors the console-breadcrumb redaction in logRedaction.ts): engine-start leaves
 * (mic / AudioWorklet / AudioContext / engine-init) are technical and PII-free by nature, but this
 * scrubs defensively so no token / bearer / email / URL query-string / long opaque blob can ever ride
 * along — transcript / audio / filler / request bodies never reach this path.
 */

export interface SanitizedLeafError {
  name: string;
  message: string;
  frames: string[];
}

const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_QUERY = /\?[^\s)'"]*/g;          // URL query strings can carry tokens/ids
const TOKEN_BLOB = /\b[A-Za-z0-9_-]{24,}\b/g; // long opaque token/base64-ish blobs (JWTs, keys)

const MAX_MESSAGE = 300;
const MAX_FRAME = 200;
const MAX_FRAMES = 5;

function scrub(input: string): string {
  return input
    .replace(BEARER, 'Bearer [redacted]')
    .replace(EMAIL, '[email]')
    .replace(URL_QUERY, '?[redacted]')
    .replace(TOKEN_BLOB, '[redacted]');
}

/**
 * Returns a redacted {name, message, frames} for any thrown value, or null if there is nothing to
 * report. Safe to pass an unknown `cause` (Error, string, arbitrary object, null/undefined).
 */
export function sanitizeStartError(err: unknown): SanitizedLeafError | null {
  if (err === null || err === undefined) return null;

  if (typeof err === 'string') {
    const message = scrub(err).slice(0, MAX_MESSAGE);
    return message ? { name: 'Error', message, frames: [] } : null;
  }

  if (typeof err !== 'object') {
    return { name: 'Error', message: scrub(String(err)).slice(0, MAX_MESSAGE), frames: [] };
  }

  const e = err as { name?: unknown; message?: unknown; stack?: unknown };
  const name = typeof e.name === 'string' && e.name ? e.name.slice(0, 100) : 'Error';
  const message = typeof e.message === 'string' ? scrub(e.message).slice(0, MAX_MESSAGE) : '';
  const frames = typeof e.stack === 'string'
    ? e.stack
        .split('\n')
        .slice(1, 1 + MAX_FRAMES) // drop line 0 ("Error: <message>"), keep the top frames
        .map((line) => scrub(line.trim()).slice(0, MAX_FRAME))
        .filter(Boolean)
    : [];

  return { name, message, frames };
}
