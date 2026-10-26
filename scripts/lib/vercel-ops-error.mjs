// The Ops Health report is public. Extract only documented, bounded error fields from
// Vercel's response body; never copy the raw body or arbitrary provider text into it.
const SAFE_CODES = new Set(['forbidden', 'unauthorized', 'bad_request', 'not_found', 'rate_limited', 'internal_server_error', 'invalid_token']);
const SAFE_MESSAGES = new Set(['not authorized', 'forbidden', 'unauthorized', 'invalid token', 'token expired']);

export function vercelErrorEvidence(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return 'apiError=non-json';
  }

  const error = body?.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return 'apiError=unexpected-schema';

  const code = typeof error.code === 'string' && SAFE_CODES.has(error.code) ? error.code : 'other';
  const message = typeof error.message === 'string' && SAFE_MESSAGES.has(error.message.trim().toLowerCase())
    ? error.message.trim().toLowerCase().replaceAll(' ', '_')
    : 'withheld';
  return `apiCode=${code}; apiMessage=${message}`;
}
