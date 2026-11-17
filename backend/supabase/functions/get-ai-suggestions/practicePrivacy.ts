import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type CoachingConsent =
  | { kind: 'granted'; revision: number }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

/** The authenticated row is the authority, never a caller flag, a default or old browser state. */
export async function readCoachingConsent(client: SupabaseClient, userId: string): Promise<CoachingConsent> {
  try {
    const { data, error } = await client.from('practice_privacy_choices')
      .select('transcript_save,ai_coaching,consent_version,choice_revision')
      .eq('user_id', userId).maybeSingle();
    if (error) return { kind: 'unavailable' };
    if (!data) return { kind: 'denied' };
    if (data.consent_version !== 1 || !Number.isSafeInteger(data.choice_revision) || data.choice_revision < 1
      || typeof data.transcript_save !== 'boolean' || typeof data.ai_coaching !== 'boolean') {
      return { kind: 'unavailable' };
    }
    if (!data.transcript_save || !data.ai_coaching) return { kind: 'denied' };
    return { kind: 'granted', revision: data.choice_revision };
  } catch {
    // Schema/network/transport failures are not consent; never emit raw database details.
    return { kind: 'unavailable' };
  }
}
