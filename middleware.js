const ADMIN_PATH = '/admin/ops-status';
const DEFAULT_USERNAME = 'admin';
const MODEL_PATH = ADMIN_PATH + '/coaching-model';
const PRODUCTION_ORIGIN = 'https://speaksharp-public.vercel.app';

export const config = {
  matcher: ['/admin/ops-status', '/admin/ops-status/:path*'],
};

export default async function middleware(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(ADMIN_PATH)) {
    return undefined;
  }

  const expectedPassword = process.env.OPS_STATUS_PASSWORD;
  if (!expectedPassword) {
    return unauthorized('Ops status access is not configured.');
  }

  const expectedUsername = process.env.OPS_STATUS_USERNAME || DEFAULT_USERNAME;
  const credentials = parseBasicAuth(request.headers.get('authorization'));

  // Both fields are always compared, and each comparison takes the same time whatever the input, so the
  // response time does not tell a caller how much of a guessed username or password was right.
  const usernameMatches = await constantTimeEqual(credentials?.username ?? '', expectedUsername);
  const passwordMatches = await constantTimeEqual(credentials?.password ?? '', expectedPassword);
  if (credentials && usernameMatches && passwordMatches) {
    if (url.pathname === MODEL_PATH) return modelAction(request, url);
    return undefined;
  }

  return unauthorized('Authentication required.');
}

// This is the only browser entry point for the admin operation. Neither the
// user's Basic credentials nor a database service-role key is forwarded.
async function modelAction(request, url) {
  const json = (value, status) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  if (url.origin !== PRODUCTION_ORIGIN || url.search) return json({ outcome: 'unavailable' }, 404);
  if (request.method !== 'GET' && request.method !== 'POST') return json({ outcome: 'unavailable' }, 405);
  if (request.method === 'POST' && (request.headers.get('Origin') !== PRODUCTION_ORIGIN
    || request.headers.get('Sec-Fetch-Site') !== 'same-origin')) return json({ outcome: 'unavailable' }, 403);

  const supabase = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const token = process.env.OPS_COACHING_CHECK_TOKEN;
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(supabase ?? '') || !anon || !token || token.length < 32) {
    return json({ outcome: 'unavailable' }, 503);
  }
  async function forward() {
    const response = await fetch(supabase.replace(/\/$/, '') + '/functions/v1/get-ai-suggestions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(33_000)]),
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: 'Bearer ' + anon,
        'x-ops-coaching-check-token': token },
      body: JSON.stringify({ operation: request.method === 'POST' ? 'admin_model_check' : 'admin_model_readback' }),
    });
    if (!response.ok) throw new Error('model operation unavailable');
    return response.json();
  }
  if (request.method === 'GET') {
    try { return json(await forward(), 200); }
    catch { return json({ outcome: 'unavailable' }, 503); }
  }
  // Routing Middleware must start the response in 25 s; keep the shared
  // 30 s lease and send JSON whitespace immediately, followed by its result.
  const encode = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(encode.encode(' '));
      let result;
      try { result = await forward(); } catch { result = { outcome: 'unavailable' }; }
      controller.enqueue(encode.encode(JSON.stringify(result)));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/**
 * Compares two strings in time that depends on neither their contents nor their lengths. Each side is reduced to
 * its SHA-256 digest first (Web Crypto, available in the Edge runtime and in Node), so the byte loop always runs over
 * 32 bytes and never exits early.
 */
export async function constantTimeEqual(supplied, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(supplied))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected))),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left[i] ^ right[i];
  }
  return difference === 0;
}

function parseBasicAuth(header) {
  if (!header?.startsWith('Basic ')) return null;

  try {
    const decoded = atob(header.slice('Basic '.length));
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function unauthorized(message) {
  return new Response(message, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="SpeakSharp Ops Status", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}
