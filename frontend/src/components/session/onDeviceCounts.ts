import React from 'react';

/**
 * S-14 — the counts computed ON DEVICE from the transcript, for the review card's still-coming state.
 *
 * They never depended on the network, which is the whole point of that state: while the review is still
 * coming (or has terminally failed), these fill the space the verdict would occupy, so the slot is never
 * empty and never a dead end.
 *
 * WHY A CONTEXT. The review card is constructed in `SessionPage` and handed to the view as an opaque
 * element, while the truthful, availability-aware counts are computed in `SessionOverhaulView`
 * (`reviewFillerCount` is null — not zero — when filler evidence is absent). Recomputing them in the page
 * would be a second source of the same numbers, which is how two surfaces come to disagree about one run.
 * Cloning props onto the opaque element would instead push unknown props onto whatever a caller passed.
 * A context lets the one owner of the numbers publish them and the one reader consume them.
 *
 * A value is `null` when it is not measured. It is never stubbed, zeroed or em-dashed by the reader.
 */
export interface OnDeviceCounts {
    fillers: number | null;
    wordsPerMinute: number | null;
}

export const OnDeviceCountsContext = React.createContext<OnDeviceCounts | null>(null);
