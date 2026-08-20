import React from 'react';
import type { SessionState } from './SessionShell';
import { PracticeFocusChooser } from './PracticeFocusChooser';
import { practiceFocusLabel, type PracticeFocus } from '@/constants/practiceFocus';

/**
 * #1222 slot D — coaching. ONE component that fills slot D in all three states; its wrapper never moves
 * (spec §1), only its content changes:
 *   • before → `◎ LIVE COACHING` + one quiet line (this slice, S3).
 *   • during → one live tip, 8s minimum hold (S5).
 *   • after  → the verdict + one fix + two actions (S6).
 *
 * Purple is the coaching/insight role (spec §2). This slice renders the before placeholder; the `during`
 * and `after` bodies are filled in by later slices via `liveTip` / `verdict` props (kept optional so this
 * component's identity is stable across states).
 */
export interface CoachingCardProps {
    sessionState: SessionState;
    /** during: the current live tip node (S5). */
    liveTip?: React.ReactNode;
    /** after: the verdict + fix + actions node (S6). */
    verdict?: React.ReactNode;
    /** #1264 — the optional Open Mic Practice Focus. `onSelectFocus` present ⇒ render the before-state
     *  chooser (Open Mic only); the selected focus rides along as a non-scoring reminder in `during`. */
    practiceFocus?: PracticeFocus | null;
    onSelectFocus?: (focus: PracticeFocus) => void;
}

const PURPLE = '#6d28d9';

const Label: React.FC<{ text: string }> = ({ text }) => (
    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: PURPLE }}>
        <span aria-hidden="true">◎</span>
        {text}
    </p>
);

export const CoachingCard: React.FC<CoachingCardProps> = ({ sessionState, liveTip, verdict, practiceFocus, onSelectFocus }) => {
    const focusLabel = practiceFocusLabel(practiceFocus);
    return (
        <div
            className="flex h-full flex-col rounded-xl border border-[#dbe2ec] bg-white p-4"
            style={{ borderTop: `3px solid ${PURPLE}` }}
            data-testid="coaching-card"
            data-coaching-state={sessionState}
        >
            {sessionState === 'before' && (
                <div data-testid="coaching-placeholder">
                    <Label text="Live coaching" />
                    <p className="mt-2 text-[14px] leading-relaxed text-[#414b5c]">
                        Your first tip appears here about 20 seconds in, based on what you actually say.
                    </p>
                    {/* #1264 — optional intention chooser (Open Mic only; present when a handler is wired). */}
                    {onSelectFocus && (
                        <div className="mt-4 border-t border-[#eef1f6] pt-3">
                            {/* #1264 — AA contrast (≥4.5:1 on white): #4b5563 ≈ 7:1, #6b7280 ≈ 4.8:1. */}
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[#4b5563]">
                                Practice focus <span className="font-semibold normal-case text-[#6b7280]">· optional</span>
                            </p>
                            <PracticeFocusChooser value={practiceFocus ?? null} onSelect={onSelectFocus} className="mt-2" />
                        </div>
                    )}
                </div>
            )}

            {sessionState === 'during' && (
                <div className="min-h-0 flex-1" data-testid="coaching-live">
                    <Label text="Live coaching" />
                    {/* #1264 — non-scoring reminder of the chosen intention (never affects the transcript). */}
                    {focusLabel && (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#f5f0ff] px-2.5 py-1 text-[12px] font-semibold text-[#6d28d9]" data-testid="practice-focus-reminder">
                            <span aria-hidden="true">◎</span> Focus: {focusLabel}
                        </p>
                    )}
                    <div className="mt-2">{liveTip}</div>
                </div>
            )}

            {sessionState === 'after' && (
                <div className="min-h-0 flex-1" data-testid="coaching-verdict">
                    <Label text="Your session" />
                    <div className="mt-2">{verdict}</div>
                </div>
            )}
        </div>
    );
};
