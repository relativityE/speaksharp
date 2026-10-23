import type { createAccountCompletionStatus } from './accountClosureCompletionStatus.ts';

type Status = ReturnType<typeof createAccountCompletionStatus>;
const reply = (status: number, body: object) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const unavailable = () => reply(503, { outcome: 'unavailable', canRetry: false });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
class BodyFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^(0|[1-9][0-9]{0,9})$/.test(length)) throw new BodyFailure(400, 'invalid_request');
    if (Number(length) > 4096) throw new BodyFailure(413, 'request_too_large');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new BodyFailure(415, 'json_required');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new BodyFailure(400, 'invalid_request');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BodyFailure(408, 'request_body_timeout')), 10_000);
  });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) throw new BodyFailure(413, 'request_too_large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    // Cancel without awaiting a potentially unresponsive stream source.
    void reader.cancel().catch(() => {});
    throw error instanceof BodyFailure ? error : new BodyFailure(400, 'invalid_request');
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* A timed-out read can still be settling. */ }
  }
}

/**
 * Inactive HTTP adapter for the accepted status factory only. No default SDK,
 * route registration, completion controller or effect port. A capability can
 * read status after Auth loss; it never authenticates an owner or grants effects.
 * The future route must retain the platform CORS and independently pinned runtime
 * controls. Keep request/response bodies out of logs, URLs and analytics.
 */
export async function handleAccountCompletionRequest(request: Request, status: Status): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { error: 'post_required' });
  try {
    const url = new URL(request.url);
    if (url.search || url.hash) return reply(400, { error: 'invalid_request' });
    const body = await readBody(request);
    if (!object(body) || !uuid(body.requestId)) return reply(400, { error: 'invalid_request' });
    const issue = body.action === 'completion_status_issue';
    const acknowledge = body.action === 'completion_status_ack';
    const read = body.action === 'completion_status_read';
    const keys = issue ? ['action', 'requestId'] : ['action', 'requestId', 'token'];
    if ((!issue && !acknowledge && !read) || Object.keys(body).length !== keys.length
      || !keys.every(key => Object.hasOwn(body, key)) || (!issue && !token(body.token))) {
      return reply(400, { error: 'invalid_request' });
    }
    if (read) return reply(200, await status.read({ requestId: body.requestId, token: body.token }));
    // This header check is not owner authentication. The accepted wrapper uses
    // authoritative same-target getUser and SQL ownership checks for issue/ACK.
    if (!/^Bearer \S{1,4096}$/.test(request.headers.get('authorization') ?? '')) {
      return reply(401, { error: 'sign_in_required' });
    }
    return reply(200, issue ? await status.issue(request, { requestId: body.requestId })
      : await status.acknowledge(request, { requestId: body.requestId, token: body.token }));
  } catch (error) {
    return error instanceof BodyFailure ? reply(error.status, { error: error.code }) : unavailable();
  }
}
