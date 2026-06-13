import { TranscriptionMode } from '../services/transcription/TranscriptionPolicy';

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'recording' | 'paused' | 'fallback' | 'error' | 'info' | 'warning' | 'download-required' | 'init-failed';

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
    };
    chunks?: { timestamp: [number, number]; text: string }[];
}
