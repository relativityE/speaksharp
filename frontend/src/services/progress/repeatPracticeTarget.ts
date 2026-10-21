import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { readSavedReview, savedReviewVersion } from '@/components/practice/lastSessionFix';
import { loadSavedFocusPointsCoverage } from '@/services/objective/savedFocusPointsCoverage';
import { authEpoch, currentOwnerId } from '@/services/loginSessionLog';
import { getOpenAttemptForUser, openAttemptSnapshot, subscribeOpenAttempt, type RepeatTargetReference } from './openAttempt';

export interface FocusTargetSelection {
    projectId: string; briefId: string; topic?: string; points?: string[];
}
/** Transient only. Captured by the component that actually renders the instruction. */
export interface DisplayedRepeatTarget {
    ownerId: string; epoch: number; sessionId: string;
    product: 'open_mic' | 'focus_points'; instruction: string;
    focus: FocusTargetSelection | null;
    isCurrent: () => boolean;
}
const unavailable = () => new Error('repeat-target-unavailable');
export function isCurrentTargetOwner(ownerId: string, epoch: number): boolean {
    return currentOwnerId() === ownerId && authEpoch() === epoch;
}
const hash = async (tuple: unknown[]): Promise<string> => {
    const bytes = new TextEncoder().encode(JSON.stringify(tuple));
    const value = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, '0')).join('');
};
const validFocus = (focus: FocusTargetSelection | null): focus is Required<FocusTargetSelection> => Boolean(
    focus && focus.projectId && focus.briefId && typeof focus.topic === 'string'
    && Array.isArray(focus.points) && focus.points.length > 0 && focus.points.every(p => typeof p === 'string' && p.trim()),
);
export function sameFocus(a: FocusTargetSelection | null, b: FocusTargetSelection | null): boolean {
    return validFocus(a) && validFocus(b) && JSON.stringify([a.projectId, a.briefId, a.topic, a.points])
        === JSON.stringify([b.projectId, b.briefId, b.topic, b.points]);
}

/** Read-only, never generate coaching. Every await is followed by the caller's identity/generation check. */
async function source(ownerId: string, sessionId: string, current: () => boolean) {
    const check = () => { if (!current()) throw unavailable(); };
    check();
    const { data, error } = await getSupabaseClient().from('sessions').select('ai_suggestions,product')
        .eq('id', sessionId).eq('user_id', ownerId).maybeSingle();
    check();
    if (error || !data) throw unavailable();
    const row = data as { ai_suggestions?: unknown; product?: unknown };
    const review = readSavedReview(row.ai_suggestions);
    const version = savedReviewVersion(row.ai_suggestions);
    if (!review || !version || (row.product !== 'open_mic' && row.product !== 'focus_points')) throw unavailable();
    const instructionHash = await hash(['repeat_cached_instruction_v1', version, review.whatToTryNext]);
    check();
    let focus: Required<FocusTargetSelection> | null = null;
    const reference: RepeatTargetReference = { version: 1, criterion: 'repeat_cached_instruction_v1', product: row.product, instructionHash };
    if (row.product === 'focus_points') {
        if (version !== 'gemini_coaching_focus_v1') throw unavailable();
        const saved = await loadSavedFocusPointsCoverage(sessionId);
        check();
        if (saved.kind !== 'coverage' || saved.briefReadFailed || !saved.brief) throw unavailable();
        focus = { projectId: saved.brief.projectId, briefId: saved.brief.briefId, topic: saved.brief.topic, points: saved.points.map(p => p.label) };
        if (!validFocus(focus)) throw unavailable();
        const setHash = await hash(['focus_set_v1', focus.projectId, focus.briefId, focus.topic, focus.points]);
        check();
        reference.focus = { projectId: focus.projectId, briefId: focus.briefId, setHash };
    }
    return { instruction: review.whatToTryNext, focus, reference };
}

export async function validateDisplayedTarget(snapshot: DisplayedRepeatTarget): Promise<RepeatTargetReference> {
    const current = () => isCurrentTargetOwner(snapshot.ownerId, snapshot.epoch) && snapshot.isCurrent();
    const saved = await source(snapshot.ownerId, snapshot.sessionId, current);
    if (!current() || saved.reference.product !== snapshot.product || saved.instruction !== snapshot.instruction
        || (snapshot.product === 'focus_points' && !sameFocus(saved.focus, snapshot.focus))) throw unavailable();
    // The displayed DTO has no version: THIS first raw read establishes it, not the earlier display moment.
    return saved.reference;
}

export async function resolveRepeatTarget(ownerId: string, sessionId: string, reference: RepeatTargetReference, current: () => boolean) {
    const saved = await source(ownerId, sessionId, current);
    if (!current() || JSON.stringify(saved.reference) !== JSON.stringify(reference)) throw unavailable();
    return { instruction: saved.instruction, focus: saved.focus };
}

export type RepeatPracticeTargetView =
    | { kind: 'none' }
    | { kind: 'pending' | 'unavailable'; retry: () => void; sourceSessionId: string }
    | { kind: 'ready'; instruction: string };

/** Owner/reference/selection gating happens during render, before any clearing effect can run. */
export function useRepeatPracticeTarget(ownerId: string | null, selection: FocusTargetSelection | null, signedOut = false): RepeatPracticeTargetView {
    const raw = useSyncExternalStore(subscribeOpenAttempt, openAttemptSnapshot, () => null);
    const epoch = authEpoch();
    const attempt = useMemo(() => ownerId && raw ? getOpenAttemptForUser(ownerId) : null, [ownerId, raw]);
    const reference = attempt?.repeatTarget;
    // The reference coaches the one accepted repeat, never a later take while its metric advance retries.
    const resolutionBound = attempt?.resolutionSessionId !== undefined;
    const key = JSON.stringify([raw, ownerId, epoch, selection, signedOut]);
    const [read, setRead] = useState<{ key: string; instruction: string | null; failed: boolean } | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const retry = () => { setRead(null); setRetryCount(n => n + 1); };
    const identityMatches = Boolean(ownerId && !signedOut && isCurrentTargetOwner(ownerId, epoch));
    useEffect(() => {
        let active = true;
        if (!ownerId || !attempt || resolutionBound || !reference || reference.version !== 1 || !identityMatches) return;
        const current = () => active && isCurrentTargetOwner(ownerId, epoch) && openAttemptSnapshot() === raw;
        void resolveRepeatTarget(ownerId, attempt.sourceSessionId, reference, current).then(value => {
            if (!current()) return;
            const matches = reference.product === 'open_mic' ? selection === null : sameFocus(value.focus, selection);
            setRead({ key, instruction: matches ? value.instruction : null, failed: !matches });
        }).catch(() => { if (current()) setRead({ key, instruction: null, failed: true }); });
        return () => { active = false; };
    }, [key, retryCount, ownerId, attempt, resolutionBound, reference, identityMatches, epoch, raw, selection]);
    if (!identityMatches || !attempt || resolutionBound || !reference) return { kind: 'none' };
    if (reference.version !== 1 || (reference.product === 'focus_points' && !validFocus(selection))
        || (reference.product === 'open_mic' && selection !== null)) return { kind: 'unavailable', retry, sourceSessionId: attempt.sourceSessionId };
    if (!read || read.key !== key) return { kind: 'pending', retry, sourceSessionId: attempt.sourceSessionId };
    return read.failed || !read.instruction ? { kind: 'unavailable', retry, sourceSessionId: attempt.sourceSessionId }
        : { kind: 'ready', instruction: read.instruction };
}
