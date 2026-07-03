import { TranscriptionMode } from '../services/transcription/TranscriptionPolicy';

// 'warming' = recording has started and the mic is acquiring/warming up, but the pipeline is not
// yet delivering stable frames. The UI must show "Starting…" and NOT invite speech until this
// transitions to 'recording' ("Speak now"). #891 immediate-start readiness contract.
export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'warming' | 'recording' | 'paused' | 'fallback' | 'error' | 'info' | 'warning' | 'download-required' | 'init-failed';

export interface SttStatus {
    type: SttStatusType;
    message: string;
    detail?: string;
    progress?: number;
    newMode?: TranscriptionMode;
    isFrozen?: boolean;
}

export interface HistorySegment {
    mode: TranscriptionMode;
    text: string;
    timestamp: number;
}

export interface TranscriptUpdate {
    serviceId?: string;
    instanceId?: string;
    transcript: {
        partial?: string;
        final?: string;
        speaker?: string;
        /**
         * When true, this `final` is a COMPLETE re-transcription that REPLACES the accumulated
         * rolling transcript — not an incremental segment to append. Set ONLY by Private's post-Stop
         * whole-utterance decode; rolling finals, partials, and Native/Cloud finals must leave it
         * unset. Without it the generic prefix/suffix/append merge concatenates rolling preview +
         * final decode (duplication / inflated WER). An empty/whitespace final never wipes existing
         * text even when this is true. Defaults to append.
         */
        replacesRollingTranscript?: boolean;
        /**
         * #891 Slice 2 (DISPLAY-ONLY): the segmented perceived-draft assembled at Stop from the
         * confirmed segments. Routed to a dedicated store field and rendered in the finalizing/dimmed
         * slot as a provisional preview; it is NEVER merged into the saved transcript (`transcript`/
         * `partial`/chunks) and never reaches the whole-utterance save-commit path. Populated ONLY when
         * the segmentation flag is on. A defined value (even '') marks the update as a segmentedDraft
         * update and is handled by its own top-of-router branch, bypassing the final/partial merge.
         */
        segmentedDraft?: string;
    };
    chunks?: { timestamp: [number, number]; text: string }[];
}
