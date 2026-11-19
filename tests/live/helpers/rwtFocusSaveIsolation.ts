/**
 * AHT-02 / AHT-03 probe-save-isolation design (Sam, #1811 RETURN on d1487bdb, item 1).
 *
 * #1812's `probeSaveIsolationRow` defaults every designed take to 'saved'. Focus has two no-save probes, so the journey passes its
 * own expectations, in Start-press order (the same order as the press budget in rwtFocusPointsJourney.ts):
 *   1. first take                         saved  (persistedId)
 *   2. Practice again's save take         saved  (repeatSessionId)
 *   3. the completed review's Retry       probe  (stops below the 5 s persist guard)
 *   4. next Start without a hold          probe  (stops below the 5 s persist guard)
 * AHT-02 (PO corpus) adds three saved takes:
 *   5. the Open Mic take before the switch saved (switchOpenMicId)
 *   6. the Focus take right after it       saved (switchFocusId)
 *   7. the take on the edited set          saved (editedTakeId)
 * The captured ids are the saved takes, in that order. An id the journey did not capture stays null, which the shared row holds
 * on; it is never dropped, so a missing take can never shift a later id onto the wrong press.
 */
/** The journey's fixture key: 'focus_points_tts' is AHT-02 (PO corpus); any other is AHT-03, as the journey's press budget chooses. */
export type FocusFixture = string;
export type SaveExpectation = 'saved' | 'probe';

export const AHT03_DESIGNED_SAVES: readonly SaveExpectation[] = Object.freeze(['saved', 'saved', 'probe', 'probe'] as const);
export const AHT02_DESIGNED_SAVES: readonly SaveExpectation[] = Object.freeze([...AHT03_DESIGNED_SAVES, 'saved', 'saved', 'saved'] as const);

export function focusDesignedSaves(fixture: FocusFixture): readonly SaveExpectation[] {
    return fixture === 'focus_points_tts' ? AHT02_DESIGNED_SAVES : AHT03_DESIGNED_SAVES;
}

export interface FocusSavedTakes {
    first: string | null;
    repeat: string | null;
    switchOpenMic: string | null;
    switchFocus: string | null;
    edited: string | null;
}

/** The captured saved ids, one per 'saved' expectation and in press order. */
export function focusCapturedTakes(fixture: FocusFixture, t: FocusSavedTakes): Array<string | null> {
    return fixture === 'focus_points_tts'
        ? [t.first, t.repeat, t.switchOpenMic, t.switchFocus, t.edited]
        : [t.first, t.repeat];
}
