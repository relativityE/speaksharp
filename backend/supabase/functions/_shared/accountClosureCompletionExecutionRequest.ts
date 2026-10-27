import type { createAccountCompletionExecutor } from './accountClosureCompletionExecutor.ts';

export const ACCOUNT_COMPLETION_EXECUTION_PATH = '/account-closure/completion-execute';
const reply = (status: number, body: object) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
class BodyFailure extends Error { constructor(readonly status: number) { super('invalid_request'); } }
async function bodyOf(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new BodyFailure(415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]{0,9})$/.test(length) || Number(length) > 4096)) throw new BodyFailure(413);
  const reader = request.body?.getReader();
  if (!reader) throw new BodyFailure(400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BodyFailure(408)), 10_000); });
  try {
    let bytes = 0, text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) throw new BodyFailure(413);
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof BodyFailure ? error : new BodyFailure(400);
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* timed-out reads can still be settling */ }
  }
}

/** Not registered. A future caller must apply existing CORS; status read/ACK never calls this adapter. */
export async function handleAccountCompletionExecutionRequest(request: Request,
  executor: ReturnType<typeof createAccountCompletionExecutor>): Promise<Response> {
  const url = new URL(request.url);
  if (![ACCOUNT_COMPLETION_EXECUTION_PATH, `/functions/v1${ACCOUNT_COMPLETION_EXECUTION_PATH}`].includes(url.pathname)) {
    return reply(404, { error: 'not_found' });
  }
  if (request.method !== 'POST') return reply(405, { error: 'post_required' });
  if (url.search || url.hash) return reply(400, { error: 'invalid_request' });
  if (!/^Bearer \S{1,4096}$/.test(request.headers.get('authorization') ?? '')) return reply(401, { error: 'sign_in_required' });
  try {
    const body = await bodyOf(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BodyFailure(400);
    const input = body as Record<string, unknown>;
    if (Object.keys(input).length !== 3 || input.action !== 'completion_execute'
      || !uuid(input.requestId) || input.confirmIrreversible !== true) throw new BodyFailure(400);
    const result = await executor.execute(request, { requestId: input.requestId });
    if (result.outcome === 'unauthorized') return reply(401, { error: 'sign_in_required' });
    if (result.outcome === 'completed') return reply(200, { outcome: 'completed', requestId: input.requestId, accountDeleted: true, canRetry: false });
    if (result.outcome === 'pending') return reply(202, { outcome: 'pending', requestId: input.requestId, canRetry: false });
    return reply(503, { outcome: 'unavailable', canRetry: false });
  } catch (error) {
    return error instanceof BodyFailure ? reply(error.status, { error: 'invalid_request' })
      : reply(503, { outcome: 'unavailable', canRetry: false });
  }
}
