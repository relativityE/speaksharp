/** Explicit effect transport; the existing capability-only status reader remains separate. */
export type CompletionExecutionResult =
  | { outcome: 'completed'; requestId: string; accountDeleted: true; canRetry: false }
  | { outcome: 'pending'; requestId: string; canRetry: false }
  | { outcome: 'unavailable'; canRetry: false };

export interface CompletionExecutionState {
  ownerId: string;
  requestId: string;
  bearer: string;
  /** The caller has secured and acknowledged the separate status capability. */
  statusSecured: boolean;
  /** An independently authorized backend readiness decision; absent means unavailable. */
  backendReady?: boolean;
  /** Changes when owner/request/lifecycle changes, including sign-out. */
  generation: number;
}

const unavailable = (): CompletionExecutionResult => ({ outcome: 'unavailable', canRetry: false });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 10_000;
const MAX_REPLY_BYTES = 8192;
const PATH = '/functions/v1/account-closure/completion-execute';
// Application-lifetime, owner/request-bound consumption also fences a second page
// instance or remount. An uncertain effect is recovered through status, never replayed.
const consumed = new Set<string>();
export const accountCompletionSubmitted = (ownerId: string, requestId: string): boolean =>
  consumed.has(`${ownerId}:${requestId}`);

function targetFor(origin: unknown): string | null {
  if (typeof origin !== 'string') return null;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === '/' || url.pathname === '') ? url.origin + PATH : null;
  } catch { return null; }
}

function parseReply(status: number, value: unknown, requestId: string): CompletionExecutionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
  const row = value as Record<string, unknown>;
  const closed = (keys: string[]) => Object.keys(row).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(row, key));
  if (row.requestId !== requestId || row.canRetry !== false) return unavailable();
  if (status === 200 && row.outcome === 'completed' && row.accountDeleted === true
    && closed(['outcome', 'requestId', 'accountDeleted', 'canRetry'])) {
    return { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
  }
  if (status === 202 && row.outcome === 'pending' && closed(['outcome', 'requestId', 'canRetry'])) {
    return { outcome: 'pending', requestId, canRetry: false };
  }
  return unavailable();
}

/**
 * Construction dispatches nothing. Only an explicit confirmed action can consume a request.
 * A consumed request stays consumed even after failure/timeout: recovery uses status, never an automatic effect retry.
 * The server independently authenticates the bearer and all operational prerequisites.
 */
export function createAccountCompletionExecution(input: {
  supabaseUrl: unknown;
  current: () => CompletionExecutionState | null;
  fetchImpl?: typeof fetch;
}) {
  const target = targetFor(input.supabaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  return async (action: { ownerId: string; requestId: string; confirmIrreversible: boolean }): Promise<CompletionExecutionResult> => {
    const state = input.current();
    if (!target || !state || state.backendReady !== true || state.statusSecured !== true
      || action.confirmIrreversible !== true || !UUID.test(action.ownerId) || !UUID.test(action.requestId)
      || state.ownerId !== action.ownerId || state.requestId !== action.requestId
      || !Number.isSafeInteger(state.generation) || !/^\S{1,4096}$/.test(state.bearer)) return unavailable();
    const snapshot = { ...state };
    const key = `${snapshot.ownerId}:${snapshot.requestId}`;
    if (consumed.has(key)) return unavailable();
    consumed.add(key);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => undefined);
        reject(new Error('timeout'));
      }, TIMEOUT_MS);
    });
    const exchange = (async () => {
      const response = await fetchImpl(target, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${snapshot.bearer}` },
        body: JSON.stringify({ action: 'completion_execute', requestId: snapshot.requestId, confirmIrreversible: true }),
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        return unavailable();
      }
      reader = response.body?.getReader();
      if (!reader) return unavailable();
      const chunks: Uint8Array[] = [];
      let count = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > MAX_REPLY_BYTES) {
          void reader.cancel().catch(() => undefined);
          return unavailable();
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return parseReply(response.status, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), snapshot.requestId);
    })();
    try {
      const result = await Promise.race([exchange, deadline]);
      const current = input.current();
      if (!current || current.ownerId !== snapshot.ownerId || current.requestId !== snapshot.requestId
        || current.generation !== snapshot.generation) return unavailable();
      return result;
    } catch { return unavailable(); }
    finally { clearTimeout(timer); }
  };
}
