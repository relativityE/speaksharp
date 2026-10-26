// Pre-grant operator readback only. Never constructs a grant or calls a provider.
export type StripeMode = 'live' | 'test' | 'missing' | 'invalid' | 'unknown';
type Env = (key: string) => string | undefined;
type FunctionName = 'stripe-checkout' | 'account-closure';
export function stripeKeyMode(key: string | undefined): StripeMode {
  return !key ? 'missing' : key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'invalid';
}
export function readAccountClosureEffectiveConfig(env: Env, capturedMode: StripeMode) {
  let siteOrigin: string | null = null;
  try {
    const site = new URL(env('SITE_URL') ?? '');
    if (site.protocol === 'https:' && !site.username && !site.password && !site.search && !site.hash && site.pathname === '/') siteOrigin = site.origin;
  } catch { /* Missing/malformed configuration is reported closed. */ }
  const configuredStripeMode = stripeKeyMode(env('STRIPE_SECRET_KEY'));
  // Checkout trims the configured price before retrieval and session creation.
  const price = env('STRIPE_PRO_PRICE_ID')?.trim();
  return { paymentsEnabled: env('PAYMENTS_ENABLED') === 'true', configuredStripeMode, capturedStripeMode: capturedMode,
    stripeModeMatches: capturedMode !== 'unknown' && capturedMode === configuredStripeMode,
    siteOrigin, proPriceId: price && /^price_[a-zA-Z0-9]+$/.test(price) ? price : null,
    anonConfigured: !!env('SUPABASE_ANON_KEY') };
}
async function serviceAuthenticated(req: Request, env: Env): Promise<boolean> {
  const secret = env('SUPABASE_SERVICE_ROLE_KEY');
  const received = req.headers.get('Authorization');
  if (!secret || !received || received.length > 8192) return false;
  const hash = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [expected, actual] = await Promise.all([hash(`Bearer ${secret}`), hash(received)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}
async function boundedBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? 0) > 1024) throw new Error('invalid probe');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('invalid probe');
  const decoder = new TextDecoder(); let bytes = 0; let text = ''; let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 2000);
  try {
    while (true) {
      const part = await reader.read();
      if (expired) throw new Error('invalid probe');
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) { await reader.cancel(); throw new Error('invalid probe'); }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
/** Call after CORS, before grant parsing, SDK construction or ordinary actions. */
export async function accountClosureConfigProbe(req: Request, env: Env, fn: FunctionName,
  readConfig: () => ReturnType<typeof readAccountClosureEffectiveConfig>): Promise<Response | null> {
  const selected = new URL(req.url).searchParams.getAll('__operator_config');
  if (selected.length === 0) return null;
  const reply = (status: number, value: object) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  // No config/platform reads before separate service authentication.
  if (!(await serviceAuthenticated(req, env))) return reply(403, { error: 'operator_auth_required' });
  if (req.method !== 'POST' || selected.length !== 1 || selected[0] !== '1') return reply(400, { error: 'invalid_probe' });
  try {
    const body = await boundedBody(req) as Record<string, unknown>;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 2
      || typeof body.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(body.nonce)
      || typeof body.expectedDeploymentId !== 'string' || body.expectedDeploymentId !== env('DENO_DEPLOYMENT_ID')) throw new Error('invalid probe');
    const url = new URL(env('SUPABASE_URL') ?? '');
    const project = /^([a-z0-9-]{1,63})\.supabase\.co$/.exec(url.hostname)?.[1];
    const deployment = body.expectedDeploymentId;
    const id = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
    const region = env('SB_REGION'); const executionId = env('SB_EXECUTION_ID');
    if (!project || url.origin !== `https://${project}.supabase.co` || url.pathname !== '/' || url.search || url.hash || url.username || url.password
      || !new RegExp(`^${project}_${id}_[1-9][0-9]*$`).test(deployment)
      || !region || !/^[a-z0-9-]{1,40}$/.test(region) || !executionId || !new RegExp(`^${id}$`).test(executionId)) throw new Error('invalid probe');
    const configuration = readConfig();
    if (!configuration.stripeModeMatches || configuration.capturedStripeMode === 'invalid') throw new Error('invalid probe');
    // Checkout concatenates the raw SITE_URL into redirects. An origin cannot
    // represent paths, trailing slashes or other URL normalization faithfully.
    // Refuse evidence for those values rather than changing ordinary behavior.
    const siteUrl = env('SITE_URL'); const price = env('STRIPE_PRO_PRICE_ID')?.trim();
    if ((siteUrl && siteUrl !== configuration.siteOrigin) || (price && price !== configuration.proPriceId)) throw new Error('invalid probe');
    return reply(200, { version: 1, function: fn, nonce: body.nonce, projectId: project, deploymentId: deployment,
      region, executionId, observedAt: Date.now(), configuration });
  } catch { return reply(503, { error: 'runtime_config_unavailable' }); }
}
