/**
 * AHT-02 / AHT-03, catalog row `same-target-repeat` (fix list item 4 of the 2026-11-10 front-run review). Before this, the Focus
 * journey made the Practice-again take but never bound it to the saved target. This is the harness's own `sameTarget` oracle
 * (draft-adapters/oracles/index.cjs, phases `begin` → `recording` → judge) for the Focus journey, with its retention boundary
 * taken from the harness module itself (`repeat-target-retention.cjs`), not a copy.
 *
 * What the row proves, in order (first failing step decides):
 *  1. the first take has a contract-valid saved review and its Focus set (brief, project, topic, ordered labels) is readable;
 *  2. while the Practice-again take records, the page shows the saved `what_to_try_next` as the practice target, and the stored
 *     open attempt binds this owner, this source session, product `focus_points`, the hash of that instruction, and the same
 *     brief, project and set hash (`ss_progress_open_attempt_v1`, written by the product's linked-repeat acceptance);
 *  3. the source's saved target is unchanged after the repeat, or lawfully expired after an independent pre-expiry witness
 *     (harness `targetRetentionVerdict`);
 *  4. the repeat take saved under the same brief with the same ordered point labels.
 * The measured-metric wording is the separate shared row `repeat result names the measured metric` (repeatMetricWording.ts).
 *
 * Fail closed: a missing read, a target that never left "Checking…", or no target shown at all is HOLD (the harness throws →
 * NOT RUN). A target the page says it could not match, or any mismatch, is FAIL. Evidence is closed codes and booleans: no
 * instruction text, label, topic or id reaches the receipt.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { FocusRowResult } from './rwtFocusPresentation';

export const FOCUS_SAME_TARGET_ROW = 'Practice again keeps the saved target';
export const OPEN_ATTEMPT_KEY = 'ss_progress_open_attempt_v1';
export const PENDING_TARGET_TEXT = 'Checking this review’s practice target…';

const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** frontend/src/services/progress/repeatPracticeTarget.ts `hash(['repeat_cached_instruction_v1', version, whatToTryNext])`. */
export const instructionHash = (version: string, whatToTryNext: string): string => sha256(['repeat_cached_instruction_v1', version, whatToTryNext]);
/** Same file: `hash(['focus_set_v1', projectId, briefId, topic, points])`. */
export const focusSetHash = (projectId: string, briefId: string, topic: string, labels: readonly string[]): string =>
    sha256(['focus_set_v1', projectId, briefId, topic, labels]);
export const pointHash = (labels: readonly string[]): string => sha256(labels);

type Retention = { status: 'PASS' | 'FAIL' | 'HOLD'; reason: string };
type RetentionJudge = (input: { before: unknown; after: unknown; authority: unknown; observedTargetMatches: boolean; ownerId: string }) => Retention;
const harnessRequire = createRequire(import.meta.url);
/** The harness's own retention boundary (tools/cloud-test/harness/draft-adapters/oracles/repeat-target-retention.cjs). */
export const harnessTargetRetention: RetentionJudge = (input) =>
    (harnessRequire('../../../tools/cloud-test/harness/draft-adapters/oracles/repeat-target-retention.cjs') as { targetRetentionVerdict: RetentionJudge })
        .targetRetentionVerdict(input);

/** One page read while the Practice-again take records (`data-session-state="during"` on /session). */
export interface TargetRead {
    kind: 'ready' | 'pending' | 'unavailable' | 'absent';
    /** The rendered instruction, only for `ready`. */
    instruction: string | null;
    /** `localStorage[ss_progress_open_attempt_v1]`, parsed; null when absent or unparseable. */
    openAttempt: unknown;
}

/** The read that decides: the last `ready` read if any (the target can resolve after recording starts), else the last read. */
export function decidingRead(reads: readonly TargetRead[]): TargetRead | null {
    const ready = reads.filter((r) => r.kind === 'ready');
    return ready.length > 0 ? ready[ready.length - 1] : reads.length > 0 ? reads[reads.length - 1] : null;
}

export interface SessionRow { id: string; user_id: string; product: string | null; ai_suggestions: unknown; status?: string; transcript_state?: string }
export interface FocusSet { briefId: string; projectId: string; topic: string; labels: readonly string[] }

export interface FocusSameTargetInput {
    ownerId: string;
    /** The first take's sessions row, read before the Practice-again take (harness phase `begin`); 'error' = read failed. */
    source: SessionRow | null | 'error';
    /** The first take's Focus set; 'error' = a read failed. */
    sourceFocus: FocusSet | null | 'error';
    /** Reads taken while the repeat recorded. */
    reads: readonly TargetRead[];
    /** The source row re-read after the repeat; must include `ai_suggestions`, `status`, `transcript_state`. */
    sourceAfter: SessionRow | null | 'error';
    /** The pre-expiry independent witness of the source's saved pair (coaching capture), or null. */
    authority: { session_id: string; user_id: string; ai_suggestions: unknown } | null;
    repeatSessionId: string | null;
    /** The repeat take's brief id and ordered labels; 'error' = a read failed; null = no objective session. */
    repeatFocus: { briefId: string; labels: readonly string[] } | null | 'error';
}

const validPair = (p: unknown): p is { version: string; what_to_try_next: string } => {
    const v = p as { version?: unknown; what_to_try_next?: unknown } | null;
    return !!v && typeof v.version === 'string' && v.version !== '' && typeof v.what_to_try_next === 'string' && v.what_to_try_next.trim() !== '';
};

/** Harness phase `recording`: the shown instruction and the stored attempt both name the saved target and this Focus set. */
export function displayedTargetMatches(read: TargetRead, ownerId: string, source: SessionRow, focus: FocusSet): boolean {
    if (read.kind !== 'ready' || !validPair(source.ai_suggestions)) return false;
    const raw = read.openAttempt as { userId?: unknown; sourceSessionId?: unknown; repeatTarget?: { version?: unknown; criterion?: unknown; product?: unknown; instructionHash?: unknown; focus?: { briefId?: unknown; projectId?: unknown; setHash?: unknown } } } | null;
    // The product hashes and shows the TRIMMED saved instruction (lastSessionFix.ts readSavedReview).
    const next = source.ai_suggestions.what_to_try_next.trim();
    const t = raw?.repeatTarget;
    return !!raw && raw.userId === ownerId && raw.sourceSessionId === source.id
        && t?.version === 1 && t.criterion === 'repeat_cached_instruction_v1' && t.product === source.product
        && t.instructionHash === instructionHash(source.ai_suggestions.version, next)
        && read.instruction === next
        && t.focus?.briefId === focus.briefId && t.focus?.projectId === focus.projectId
        && t.focus?.setHash === focusSetHash(focus.projectId, focus.briefId, focus.topic, focus.labels);
}

export function focusSameTargetVerdict(input: FocusSameTargetInput, retention: RetentionJudge = harnessTargetRetention): FocusRowResult {
    const deciding = decidingRead(input.reads);
    const evidence: Record<string, string | number | boolean | null> = {
        reads: input.reads.length, shown: deciding?.kind ?? 'not-observed', targetMatches: null, retention: null, sameSet: null,
    };
    const out = (verdict: FocusRowResult['verdict'], detail: string, reason: string): FocusRowResult => ({ verdict, detail, evidence: { ...evidence, reason } });
    const { source, sourceFocus } = input;
    if (source === 'error' || sourceFocus === 'error') return out('HOLD', 'the first take\'s saved target or Focus set could not be read', 'source-unread');
    if (!source || source.user_id !== input.ownerId || source.product !== 'focus_points' || !validPair(source.ai_suggestions)) {
        return out('HOLD', 'the first take has no saved Focus coaching target to practise', 'saved-target-missing');
    }
    if (!sourceFocus || sourceFocus.labels.length === 0) return out('HOLD', 'the first take has no saved Focus set', 'source-set-missing');
    if (!input.repeatSessionId || input.repeatSessionId === source.id) return out('HOLD', 'the Practice-again take is not a distinct saved take', 'no-distinct-repeat');
    if (!deciding) return out('HOLD', 'the page was not read while the Practice-again take recorded', 'not-observed');
    if (deciding.kind === 'absent') return out('HOLD', 'no practice target was shown while the Practice-again take recorded', 'no-target-shown');
    if (deciding.kind === 'pending') return out('HOLD', 'the practice target was still being checked for the whole take', 'target-pending');
    if (deciding.kind === 'unavailable') {
        evidence.targetMatches = false;
        return out('FAIL', 'the page said the review\'s target or Focus set could not be matched', 'target-unavailable');
    }
    const matches = displayedTargetMatches(deciding, input.ownerId, source, sourceFocus);
    evidence.targetMatches = matches;
    if (!matches) return out('FAIL', 'the shown target or its stored link is not the saved target of this Focus set', 'displayed-target-mismatch');
    if (input.sourceAfter === 'error' || !input.sourceAfter) return out('HOLD', 'the first take could not be re-read after the repeat', 'source-after-unread');
    const kept = retention({ before: source, after: input.sourceAfter, authority: input.authority, observedTargetMatches: true, ownerId: input.ownerId });
    evidence.retention = kept.reason;
    if (kept.status !== 'PASS') return out(kept.status, kept.status === 'FAIL' ? 'the saved target changed after the repeat' : 'the saved target\'s retention could not be established', 'retention');
    if (input.repeatFocus === 'error') return out('HOLD', 'the repeat take\'s Focus set could not be read', 'repeat-set-unread');
    const same = !!input.repeatFocus && input.repeatFocus.briefId === sourceFocus.briefId && pointHash(input.repeatFocus.labels) === pointHash(sourceFocus.labels);
    evidence.sameSet = same;
    if (!same) return out('FAIL', 'the repeat take was not saved under the same Focus set', 'set-changed');
    return out('PASS', 'the repeat showed and kept the saved target and saved under the same Focus set', 'ok');
}

/**
 * Page-side read, passed to `page.evaluate`. Self-contained: no closure over module values.
 * Returns null when the page is not recording on /session.
 */
export function readTargetInPage(): { kind: 'ready' | 'pending' | 'unavailable' | 'absent'; instruction: string | null; openAttempt: unknown } | null {
    const shell = document.querySelector('[data-testid="session-shell"]');
    if (location.pathname !== '/session' || shell?.getAttribute('data-session-state') !== 'during') return null;
    let openAttempt: unknown = null;
    try { openAttempt = JSON.parse(localStorage.getItem('ss_progress_open_attempt_v1') ?? 'null'); } catch { openAttempt = null; }
    const target = document.querySelector('[data-testid="repeat-practice-target"]');
    if (!target) return { kind: 'absent', instruction: null, openAttempt };
    if (target.querySelector('button')) return { kind: 'unavailable', instruction: null, openAttempt };
    const text = (target.querySelector('p')?.textContent ?? '').trim();
    if (text === '' || text === 'Checking this review’s practice target…') return { kind: 'pending', instruction: null, openAttempt };
    return { kind: 'ready', instruction: text, openAttempt };
}
