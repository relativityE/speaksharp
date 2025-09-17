// This is a declaration file for the JavaScript TranscriptionService.js
// It provides types for TypeScript without converting the file itself.

import type { UserProfile } from '@/types/user';
import type { Session as SupabaseSession } from '@supabase/supabase-js';

interface TranscriptionServiceOptions {
    onTranscriptUpdate: (data: any) => void;
    onModelLoadProgress: (progress: any) => void;
    onReady: () => void;
    profile?: UserProfile | null;
    forceCloud?: boolean;
    forceOnDevice?: boolean;
    forceNative?: boolean;
    session?: SupabaseSession | null;
    navigate: (path: string) => void;
    getAssemblyAIToken: () => Promise<string | null>;
}

export default class TranscriptionService {
    constructor(options: TranscriptionServiceOptions);
    mode: 'cloud' | 'on-device' | 'native' | null;
    init(): Promise<{ success: boolean }>;
    startTranscription(): Promise<void>;
    stopTranscription(): Promise<any | null>;
    getTranscript(): Promise<string>;
    destroy(): Promise<void>;
}
