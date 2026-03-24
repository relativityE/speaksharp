import { TranscriptionMode } from '../services/transcription/TranscriptionPolicy';

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'recording' | 'paused' | 'fallback' | 'error' | 'info' | 'warning' | 'download-required';

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
    };
    chunks?: { timestamp: [number, number]; text: string }[];
}
