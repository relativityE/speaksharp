import { TranscriptionMode } from '../services/transcription/TranscriptionPolicy';

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'recording' | 'fallback' | 'error' | 'info' | 'warning';

export interface SttStatus {
    type: SttStatusType;
    message: string;
    detail?: string;
    progress?: number;
    newMode?: TranscriptionMode;
    isFrozen?: boolean;
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
