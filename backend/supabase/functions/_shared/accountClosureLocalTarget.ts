/**
 * The one definition of a LOCAL disposable target, shared by the closure and completion runtime bindings (J1.f/J7.d).
 * Admitted only for a manifest that declares `disposable`; the hosted production rule is separate and unchanged.
 *   - exactly http://kong:8000: `supabase functions serve` sets the function's SUPABASE_URL to this, after the env-file
 *     entries, so an env-file cannot change it;
 *   - plain http on a loopback host: a stack served directly on the runner.
 * A deployed function's platform-supplied URL is https://<ref>.supabase.co, never one of these.
 */
const CLI_STACK_ORIGIN = 'http://kong:8000';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalDisposableTarget(url: URL): boolean {
  return url.protocol === 'http:' && (url.origin === CLI_STACK_ORIGIN || LOOPBACK_HOSTS.has(url.hostname));
}

/**
 * The local app origin a disposable stack may send its deletion verification link to: plain http on a loopback host. Only
 * ever admitted by a caller that has already verified its own runtime target is a local disposable stack.
 */
export function isLoopbackHttpOrigin(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}
