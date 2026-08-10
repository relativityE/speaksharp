import { useRef } from 'react';
import { advanceNudge, initialNudgeState, type NudgeInputs, type NudgeState } from '@/utils/focusNudge';

/**
 * #1046 G6/G7 §2 — thin stateful wrapper over the pure {@link advanceNudge} reducer. Returns the current
 * nudge text (or null when silent). Time base is the monotonic `elapsedSec` in `inputs`, so the reducer is
 * deterministic and the 8s-hold / 2-per-run / never-after-last discipline lives in the tested pure layer.
 *
 * Strict-mode safe: a repeated render with identical inputs either re-fires into the min-hold window (no
 * double count) or is a no-op, so double-invocation cannot inflate the per-run count.
 */
export function useFocusNudge(inputs: NudgeInputs): string | null {
    const stateRef = useRef<NudgeState>(initialNudgeState);
    stateRef.current = advanceNudge(stateRef.current, inputs);
    return stateRef.current.activeText;
}
