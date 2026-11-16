const ADMIN_PATH = '/admin/ops-status';
const DEFAULT_USERNAME = 'admin';

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
    return undefined;
  }

  return unauthorized('Authentication required.');
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
