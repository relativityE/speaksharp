import { getSupabaseClient } from '@/lib/supabaseClient';
import { analyticsBuffer } from './AnalyticsBuffer';
import logger from '@/lib/logger';

/**
 * #1061 Guided Rehearsal "Notify me" — client seam for the durable waitlist.
 *
 * The browser NEVER writes the table; it calls the `guided-waitlist` Edge Function, which uses the
 * service-role key to normalize/validate/dedup server-side. This module only forwards the request and
 * emits a CONTENT-FREE conversion event (no email/PII ever leaves as an analytics property).
 */

export type GuidedWaitlistSource = 'anonymous_landing' | 'authenticated_practice';
const GUIDED_PRODUCT = 'guided_rehearsal'; // stable internal token (NOT the user-facing label)

export interface GuidedWaitlistResult {
  ok: boolean;
}

/**
 * Submit interest. Resolves { ok: true } on success (new OR already-on-list — the server is idempotent and
 * never discloses which), { ok: false } on validation/transport/server failure so the UI can show honest,
 * non-fabricated states. Emits `guided_waitlist_submitted` with NO PII (source / auth-state / success only).
 */
export async function submitGuidedWaitlist(params: {
  email: string;
  consent: boolean;
  source: GuidedWaitlistSource;
}): Promise<GuidedWaitlistResult> {
  const { email, consent, source } = params;
  let ok = false;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('guided-waitlist', {
      body: { email, consent, source, product: GUIDED_PRODUCT },
    });
    ok = !error && !!(data as { ok?: boolean } | null)?.ok;
  } catch (err) {
    // Log the failure WITHOUT the email (never log PII).
    logger.error({ err, source }, '[guidedWaitlist] submit failed');
    ok = false;
  }

  // Content-free conversion signal — analytics only, never the durable record; carries NO email/PII.
  analyticsBuffer.push(
    'guided_waitlist_submitted',
    { source, authenticated: source === 'authenticated_practice', success: ok, product: GUIDED_PRODUCT },
    'HIGH',
  );

  return { ok };
}
