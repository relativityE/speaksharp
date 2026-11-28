import { READINESS_LABELS, TARGET_FEEL_LABELS, type ConfidencePilotState } from './pilotState';

/** After the reveal: the user's own answers, labelled self-reported and kept apart from the measured review. */
export function youSaidText(state: Pick<ConfidencePilotState, 'pre' | 'post' | 'feel'>): string | null {
    const parts: string[] = [];
    const rated = (a: ConfidencePilotState['pre']) => (typeof a === 'number' ? `${a} (${READINESS_LABELS[a]})` : null);
    const before = rated(state.pre);
    const after = rated(state.post);
    if (before && after) parts.push(`readiness ${before} before the loop, ${after} now`);
    else if (after) parts.push(`readiness ${after} now`);
    if (state.feel && state.feel !== 'skipped') parts.push(`target felt: ${TARGET_FEEL_LABELS[state.feel].toLowerCase()}`);
    return parts.length ? `You said: ${parts.join(' · ')}.` : null;
}
