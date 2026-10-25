/**
 * #1643 — Auth-independent transport for the inactive completion status route (6fabe3f1, ACCOUNT_COMPLETION_STATUS_PATH;
 * Sam design acceptance 1792549859). Plain fetch only: no Supabase client, so no session lookup or refresh can happen on
 * any call, and a capability read after the account's sign-in is gone sends no Authorization at all. Issue/ACK carry
 * exactly the owner JWT the caller already checked. The target is fixed and validated once, never derived from a reply.
 */
import type { CompletionTransport } from './accountCompletionClient';

export const COMPLETION_STATUS_PATH = '/functions/v1/account-closure/completion-status';
const MAX_REPLY_BYTES = 8192;
/** Whole-call deadline (request + body). A stalled reply must not leave a call or a shared issuance flight pending. */
export const COMPLETION_TIMEOUT_MS = 10_000;
const BEARER = /^\S{1,4096}$/;

/** The one completion-status URL for a Supabase project origin; null unless it is a plain HTTPS origin. */
export function completionStatusTarget(supabaseUrl: unknown): string | null {
  if (typeof supabaseUrl !== 'string') return null;
  let url: URL;
  try { url = new URL(supabaseUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) return null;
  return `${url.origin}${COMPLETION_STATUS_PATH}`;
}

/**
 * A transport bound to one validated target. Returns null for an invalid target (the caller treats that as unavailable).
 * Each call: POST of the closed body, `credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'`; Authorization only
 * when a bearer is given. The reply is read up to MAX_REPLY_BYTES raw bytes, decoded as strict UTF-8 and parsed as JSON;
 * anything else throws. The whole call is bounded by COMPLETION_TIMEOUT_MS: at the deadline the request is aborted, the
 * body stream cancelled (without waiting for it) and the call rejects with 'timeout'.
 */
export function createCompletionTransport(supabaseUrl: unknown, fetchImpl: typeof fetch = fetch): CompletionTransport | null {
  const target = completionStatusTarget(supabaseUrl);
  if (!target) return null;
  return async (body, bearer) => {
    if (bearer !== null && !BEARER.test(bearer)) throw new Error('invalid_bearer');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => undefined);
        reject(new Error('timeout'));
      }, COMPLETION_TIMEOUT_MS);
    });
    const exchange = (async () => {
      const response = await fetchImpl(target, {
        method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: controller.signal,
      });
      // A fetch that ignored the abort and resolved after the deadline: drop its body unread, without waiting on it.
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error('timeout');
      }
      reader = response.body?.getReader();
      return JSON.parse(await boundedText(reader)) as unknown;
    })();
    try {
      return await Promise.race([exchange, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Read at most MAX_REPLY_BYTES raw bytes (cancelling the stream beyond that) and decode them as strict UTF-8. */
async function boundedText(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): Promise<string> {
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REPLY_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new Error('reply_too_large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}
