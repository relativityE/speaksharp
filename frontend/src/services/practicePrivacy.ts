/**
 * #1835 — the signed-in owner's practice privacy choices (PO-approved policy, 17 Nov):
 *   - transcript saving is OFF until the user opts in;
 *   - AI coaching is a separate opt-in and requires saving in v1;
 *   - an existing user with no recorded choice is asked on their next Practice visit, and automatic coaching stays paused
 *     until they choose; past data is left as it is.
 *
 * The server is the authority (`practice_privacy_choices`, `set_practice_privacy_choices_v1`, the transcript trigger and
 * the coaching function's own consent read). This module is the client's view of it, used to decide what the UI offers:
 * whether a completion sends transcript text, whether coaching may be requested, and whether a late review may be shown.
 *
 * FAIL CLOSED. Until THIS owner's own row has been read, everything is off: loading, a read error, a malformed row, no
 * row, and another owner's state all mean "no transcript text, no coaching request". A state is bound to the owner it
 * was read for; an account change discards it before anything can act on it, and a read that returns after the owner
 * changed is dropped.
 */
import { create } from 'zustand';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';

export type PracticePrivacyStatus =
  /** No signed-in owner. */
  | 'signed_out'
  /** This owner's row is being read. Treated as off. */
  | 'loading'
  /** No recorded choice: the owner must be asked. Treated as off. */
  | 'unknown'
  /** The owner's recorded choice. */
  | 'chosen'
  /** The row could not be read or was not one this client understands. Treated as off. */
  | 'unavailable';

export interface PracticePrivacyState {
  ownerId: string | null;
  status: PracticePrivacyStatus;
  transcriptSave: boolean;
  aiCoaching: boolean;
  /** The server's choice_revision for the state shown; null when there is no recorded choice. */
  revision: number | null;
}

export type SavePracticePrivacyResult = { ok: true } | { ok: false; reason: 'not_signed_in' | 'invalid_choice' | 'failed' };

const OFF = { transcriptSave: false, aiCoaching: false, revision: null } as const;

export const usePracticePrivacyStore = create<PracticePrivacyState>(() => ({ ownerId: null, status: 'signed_out', ...OFF }));

/** Monotonic, so a read or write that settles after a newer one (or after an owner change) never lands. */
let operation = 0;

type ChoiceRow = { transcript_save: unknown; ai_coaching: unknown; consent_version: unknown; choice_revision: unknown };

/** A row this client understands, or null. Never trusts a value it did not check. */
function parseChoiceRow(row: ChoiceRow | null | undefined): Pick<PracticePrivacyState, 'transcriptSave' | 'aiCoaching' | 'revision'> | null {
  if (!row) return null;
  const { transcript_save: save, ai_coaching: ai, consent_version: version, choice_revision: revision } = row;
  if (typeof save !== 'boolean' || typeof ai !== 'boolean' || version !== 1) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return null;
  // The server forbids AI without saving; a row that says otherwise is not one this client acts on.
  if (ai && !save) return null;
  return { transcriptSave: save, aiCoaching: ai, revision };
}

/**
 * Points the store at `ownerId` (null when signed out) and reads that owner's row. Calling it again for the SAME owner
 * re-reads without first dropping to off, so a settled choice does not flicker; a DIFFERENT owner is set to `loading`
 * synchronously, before anything else can read the previous owner's choice.
 */
export async function loadPracticePrivacy(ownerId: string | null): Promise<void> {
  const op = ++operation;
  const current = usePracticePrivacyStore.getState();
  if (!ownerId) {
    usePracticePrivacyStore.setState({ ownerId: null, status: 'signed_out', ...OFF });
    return;
  }
  if (current.ownerId !== ownerId) {
    usePracticePrivacyStore.setState({ ownerId, status: 'loading', ...OFF });
  }
  let next: PracticePrivacyState;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('practice_privacy_choices')
      .select('transcript_save,ai_coaching,consent_version,choice_revision')
      .eq('user_id', ownerId)
      .maybeSingle();
    if (error) throw new Error('read failed');
    if (!data) {
      next = { ownerId, status: 'unknown', ...OFF };
    } else {
      const parsed = parseChoiceRow(data as ChoiceRow);
      next = parsed ? { ownerId, status: 'chosen', ...parsed } : { ownerId, status: 'unavailable', ...OFF };
    }
  } catch {
    // Content-free: a read failure is not consent, and nothing about the row is logged.
    logger.warn('[practicePrivacy] could not read the practice privacy choices; treating them as off');
    next = { ownerId, status: 'unavailable', ...OFF };
  }
  if (op !== operation || usePracticePrivacyStore.getState().ownerId !== ownerId) return;
  usePracticePrivacyStore.setState(next);
}

/**
 * Records the owner's choice through the one atomic RPC. AI coaching without saving is refused here as well as by the
 * server. A turn-off takes effect in this client at once, before the server answers, so no new transcript text or
 * coaching request can start while it is in flight; a turn-on takes effect only once the server confirms it.
 */
export async function savePracticePrivacy(transcriptSave: boolean, aiCoaching: boolean): Promise<SavePracticePrivacyResult> {
  const { ownerId, transcriptSave: wasSave, aiCoaching: wasAi } = usePracticePrivacyStore.getState();
  if (!ownerId) return { ok: false, reason: 'not_signed_in' };
  if (aiCoaching && !transcriptSave) return { ok: false, reason: 'invalid_choice' };
  const op = ++operation;
  if ((wasSave && !transcriptSave) || (wasAi && !aiCoaching)) {
    // Immediate refusal for new work. The revision is cleared too, so a review requested under the old revision is
    // recognised as late and dropped when it settles.
    usePracticePrivacyStore.setState({ transcriptSave: wasSave && transcriptSave, aiCoaching: wasAi && aiCoaching, revision: null });
  }
  try {
    const { data, error } = await getSupabaseClient().rpc('set_practice_privacy_choices_v1', {
      p_transcript_save: transcriptSave,
      p_ai_coaching: aiCoaching,
    });
    if (error) throw new Error('write failed');
    const parsed = parseChoiceRow((Array.isArray(data) ? data[0] : data) as ChoiceRow | null);
    if (!parsed || parsed.transcriptSave !== transcriptSave || parsed.aiCoaching !== aiCoaching) throw new Error('unexpected result');
    if (op === operation && usePracticePrivacyStore.getState().ownerId === ownerId) {
      usePracticePrivacyStore.setState({ ownerId, status: 'chosen', ...parsed });
    }
    return { ok: true };
  } catch {
    logger.warn('[practicePrivacy] could not record the practice privacy choices');
    // The client no longer knows what the server holds. A turn-off already applied here stays applied until the re-read
    // answers; a turn-on was never applied. The re-read then shows the server's own state.
    if (op === operation && usePracticePrivacyStore.getState().ownerId === ownerId) void loadPracticePrivacy(ownerId);
    return { ok: false, reason: 'failed' };
  }
}

/** True only when this owner's own recorded choice keeps transcript text. */
export function transcriptSaveAllowed(state: PracticePrivacyState = usePracticePrivacyStore.getState()): boolean {
  return state.status === 'chosen' && state.ownerId !== null && state.transcriptSave;
}

/** True only when this owner's own recorded choice allows a fresh AI coaching request. */
export function coachingAllowed(state: PracticePrivacyState = usePracticePrivacyStore.getState()): boolean {
  return state.status === 'chosen' && state.ownerId !== null && state.transcriptSave && state.aiCoaching && state.revision !== null;
}

/**
 * A token for one coaching request: the owner and revision it was allowed under. `stillAllowed` is false once the owner
 * changed, coaching was turned off, or the choice was re-recorded since, so a late review is dropped rather than shown.
 */
export function captureCoachingConsent(): { ownerId: string; revision: number } | null {
  const state = usePracticePrivacyStore.getState();
  if (!coachingAllowed(state) || state.ownerId === null || state.revision === null) return null;
  return { ownerId: state.ownerId, revision: state.revision };
}

export function coachingConsentStillHolds(token: { ownerId: string; revision: number } | null): boolean {
  if (!token) return false;
  const state = usePracticePrivacyStore.getState();
  return coachingAllowed(state) && state.ownerId === token.ownerId && state.revision === token.revision;
}

/** Test seam only. */
export function resetPracticePrivacyForTests(): void {
  operation += 1;
  usePracticePrivacyStore.setState({ ownerId: null, status: 'signed_out', ...OFF });
}
