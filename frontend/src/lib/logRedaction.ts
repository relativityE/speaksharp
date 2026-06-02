/**
 * Privacy: transcript text must NEVER reach logs that can leave the device.
 *
 * `logger` is pino -> browser console, and Sentry's default Breadcrumbs integration
 * captures `console.*` into breadcrumbs that ship with error events. So any transcript
 * text passed to `logger.*` can leave the browser to Sentry on error — which would make
 * the Private "nothing leaves your browser" promise technically false.
 *
 * Two layers of defense (do not rely on one):
 *  1. SOURCE: never log raw transcript text — log only safe diagnostics
 *     (length, word count, redacted: true). Use `redactTranscript()`.
 *  2. SINK: drop console breadcrumbs entirely before Sentry records them.
 *     Use `scrubConsoleBreadcrumb()` as Sentry.init `beforeBreadcrumb`.
 */

export interface RedactedTranscript {
  length: number;
  words: number;
  redacted: true;
}

/** Replace raw transcript text in a log payload with safe, non-reversible diagnostics. */
export function redactTranscript(text: string | null | undefined): RedactedTranscript {
  const value = typeof text === 'string' ? text : '';
  return {
    length: value.length,
    words: value.trim() ? value.trim().split(/\s+/).length : 0,
    redacted: true,
  };
}

/**
 * Sentry `beforeBreadcrumb` hook: drop ALL `console` breadcrumbs so transcript text
 * (or anything else logged) can never be exfiltrated via the console-breadcrumb path.
 * Non-console breadcrumbs (navigation, fetch, ui.click, etc.) are preserved.
 * Returns `null` to drop, or the breadcrumb to keep.
 */
export function scrubConsoleBreadcrumb<T extends { category?: string } | null>(
  breadcrumb: T,
): T | null {
  if (breadcrumb && breadcrumb.category === 'console') return null;
  return breadcrumb;
}
