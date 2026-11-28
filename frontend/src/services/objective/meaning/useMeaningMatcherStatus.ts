/** React view of the page's meaning matcher status (default-off feature; only used by the opt-in control). */
import { useSyncExternalStore } from 'react';
import { getMeaningMatcher, type MeaningMatcherStatus } from './MeaningMatcher';

export function useMeaningMatcherStatus(): MeaningMatcherStatus {
    const matcher = getMeaningMatcher();
    return useSyncExternalStore(
        (listener) => matcher.subscribe(listener),
        () => matcher.getStatus(),
        () => matcher.getStatus(),
    );
}
