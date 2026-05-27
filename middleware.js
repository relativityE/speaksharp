const ADMIN_PATH = '/admin/ops-status';
const DEFAULT_USERNAME = 'admin';

export const config = {
  matcher: ['/admin/ops-status', '/admin/ops-status/:path*'],
};

export default function middleware(request) {
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

  if (
    credentials?.username === expectedUsername &&
    credentials.password === expectedPassword
  ) {
    return undefined;
  }

  return unauthorized('Authentication required.');
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
