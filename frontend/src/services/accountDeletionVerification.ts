/** Run before the rest of application startup. Never persist/log the emailed deletion secret. */
let verificationToken: string | null = null;

export function captureDeletionToken(url: URL): { token: string | null; sanitized: URL } {
  const sanitized = new URL(url.href);
  const raw = sanitized.searchParams.get('account_deletion_token');
  sanitized.searchParams.delete('account_deletion_token');
  return {
    token: url.pathname === '/account/delete' && raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null,
    sanitized,
  };
}

if (typeof window !== 'undefined') {
  const original = new URL(window.location.href);
  if (original.searchParams.has('account_deletion_token')) {
    const captured = captureDeletionToken(original);
    verificationToken = captured.token;
    // Preserve Supabase's authentication fragment; remove only our secret before telemetry imports.
    window.history.replaceState(window.history.state, '', captured.sanitized.href);
  }
}

export const accountDeletionToken = () => verificationToken;
export const clearAccountDeletionToken = () => { verificationToken = null; };
/** Claim the current in-memory link once, before any asynchronous confirmation work. */
export function consumeAccountDeletionToken(expected: string): boolean {
  if (verificationToken !== expected) return false;
  clearAccountDeletionToken();
  return true;
}
