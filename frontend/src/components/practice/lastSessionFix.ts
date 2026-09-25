/**
 * Brief H-4 — reading the ONE sentence the resume band shows: the fix from the last session's review,
 * verbatim, so the lesson is recognisable rather than restated.
 *
 * WHERE IT COMES FROM, AND WHY THIS IS A READ AND NOT NEW PERSISTENCE. `get-ai-suggestions` caches the
 * generated review on the session row (`sessions.ai_suggestions`) server-side, in exactly the shape its own
 * `parseSuggestions` will accept back: `{version, what_worked, what_to_try_next}` and nothing else. The
 * fix is `what_to_try_next`. Home therefore needs no migration and no new write: it reads the row the Edge
 * function already wrote and shows the same sentence the session page showed.
 *
 * #1306 is not weakened by this. That rule governs what crosses the **client persistence** interface —
 * `storage.ts` still strips `ai_suggestions` as a content field, the typed `PracticeSession` model still
 * carries no coaching prose, and nothing here writes anything. This module only parses a value that is
 * already stored, and it deliberately returns a bare string rather than widening the session model, so the
 * prose reaches exactly one component and spreads no further.
 *
 * FAIL CLOSED. The same key-set and non-empty checks the Edge function applies are applied again here,
 * because a value that does not match the contract is not a review: a half-written row, a legacy free-form
 * payload or an unparseable blob must yield `null` so the band falls back to the run's earned facts. It
 * must never render a truncated fragment, an object, or the word `undefined` as a user's lesson.
 */

/** The exact key set the review contract allows. Anything else is not a review. */
const REVIEW_KEYS = ['version', 'what_to_try_next', 'what_worked'] as const;

/**
 * The ONLY coaching contract version this reader trusts, mirroring the authoritative Edge parser
 * (`get-ai-suggestions`, which requires exactly this literal). A legacy, corrupted or future-version row
 * can carry the same three keys with different semantics, so accepting any version would present
 * untrusted text to the user as their lesson. Fail closed instead.
 */
const COACHING_VERSION = 'gemini_coaching_v1';

/**
 * The fix sentence from a persisted review, or `null` when there is no contract-valid review to quote.
 *
 * `raw` is whatever the column held: an object (jsonb), a JSON string (a legacy text column or a
 * double-encoded write), or nothing at all.
 */
export function readLastSessionFix(raw: unknown): string | null {
    return readSavedReview(raw)?.whatToTryNext ?? null;
}

/** Both halves of a contract-valid saved review, trimmed. */
export interface SavedReview {
    whatWorked: string;
    whatToTryNext: string;
}

/**
 * The whole persisted review, or `null` when there is no contract-valid review. Same fail-closed checks as
 * above; the Analytics session detail uses it to show the saved review in full (#1258).
 */
export function readSavedReview(raw: unknown): SavedReview | null {
    const candidate = typeof raw === 'string' ? safeParse(raw) : raw;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const keys = Object.keys(candidate as Record<string, unknown>).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...REVIEW_KEYS])) return null;
    if ((candidate as Record<string, unknown>).version !== COACHING_VERSION) return null;
    const fix = (candidate as Record<string, unknown>).what_to_try_next;
    const worked = (candidate as Record<string, unknown>).what_worked;
    // Both halves must be present and non-blank: a row carrying only one of them is a partial write,
    // and quoting half a review as the user's lesson is worse than falling back.
    if (typeof fix !== 'string' || typeof worked !== 'string') return null;
    if (!fix.trim() || !worked.trim()) return null;
    return { whatWorked: worked.trim(), whatToTryNext: fix.trim() };
}

function safeParse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
