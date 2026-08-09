import React from 'react';
import { SessionBeforeState, type SessionBeforeStateProps } from './SessionBeforeState';
import { SessionDuringState, type SessionDuringStateProps } from './SessionDuringState';
import { SessionAfterState, type SessionAfterStateProps } from './SessionAfterState';
import { CoverageRail, type CoverageRailPoint } from './CoverageRail';

/**
 * #1222 S8 — **Focus Points** on the SAME shell (PO-confirmed shared shell). Focus Points is the sibling
 * of Open Floor: identical 4 fixed slots (A mic/recorder/scrubber · B transcript · C progress), the ONE
 * difference being **slot D**:
 *   • before → the capture step (declare the points to cover), supplied by the caller.
 *   • during/after → the Focus Points **coverage rail** (#1046's `CoverageRail`) instead of the coaching
 *     card / verdict.
 *
 * These are thin wrappers over the Open-Floor state compositions using their `slotDContent` override, so
 * slot identity/position is guaranteed to match Open Floor (the shell owns the grid). STT stays Private
 * only — no engine selector, same as Open Floor.
 */

/** before — Open Floor before + the capture step in slot D. */
export const FocusPointsBeforeState: React.FC<SessionBeforeStateProps & { capture: React.ReactNode }> = ({
    capture,
    ...before
}) => <SessionBeforeState {...before} slotDContent={capture} />;

/** during — Open Floor during + the live coverage rail in slot D. */
export const FocusPointsDuringState: React.FC<
    Omit<SessionDuringStateProps, 'liveTip'> & { points: CoverageRailPoint[] }
> = ({ points, ...during }) => (
    <SessionDuringState {...during} slotDContent={<CoverageRail points={points} />} />
);

/** after — Open Floor after + the resolved coverage rail in slot D (replaces the verdict). */
export const FocusPointsAfterState: React.FC<
    Omit<SessionAfterStateProps, 'verdict'> & { points: CoverageRailPoint[] }
> = ({ points, ...after }) => (
    <SessionAfterState
        {...after}
        // The verdict slot is unused for Focus Points; the rail carries the outcome.
        verdict={{ verdictLine: '', fix: '', onPracticeAgain: () => {}, onSeeAllSessions: () => {} }}
        slotDContent={<CoverageRail points={points} />}
    />
);
