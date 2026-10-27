/** Private exact-request recovery. Requires separate operational authorization. */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { recoverAccountClosureAsOperator } from '../backend/supabase/functions/_shared/accountClosureOperatorRecovery.ts';

export async function runRecovery(env: (key: string) => string | undefined) {
  const secret = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) return { outcome: 'hold', stage: 'authority', reason: 'authority_unavailable', accountDeleted: null };
  return await recoverAccountClosureAsOperator({ userId: env('ACCOUNT_CLOSURE_RECOVERY_USER_ID') ?? '',
    requestId: env('ACCOUNT_CLOSURE_RECOVERY_REQUEST_ID') ?? '' }, { env, fetch,
    createAdminClient: (url) => createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) });
}
if (import.meta.main) {
  const result = await runRecovery((key) => Deno.env.get(key));
  // No manifest, identity, credential, private row or provider response is logged.
  console.log(JSON.stringify(result));
  if (result.outcome !== 'completed') Deno.exitCode = 1;
}
