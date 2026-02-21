import { TranscriptionMode } from '../services/transcription/TranscriptionPolicy';

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'recording' | 'fallback' | 'error' | 'info' | 'cleaning';

export interface SttStatus {
    type: SttStatusType;
    message: string;
    detail?: string;
    progress?: number;
    newMode?: TranscriptionMode;
}

export interface TranscriptUpdate {
    transcript: {
        partial?: string;
        final?: string;
        speaker?: string;
    };
    chunks?: { timestamp: [number, number]; text: string }[];
}
