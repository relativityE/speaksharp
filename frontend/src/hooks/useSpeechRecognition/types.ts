import type { Session as SupabaseSession } from '@supabase/supabase-js';
import type { UserProfile } from '../../types/user';

export interface Chunk {
  text: string;
  id: number;
  speaker?: string;
}

export interface WordConfidence {
  word: string;
  confidence: number;
  speaker?: string;
}

export interface UseSpeechRecognitionProps {
  customWords?: string[];
  customVocabulary?: string[];
  session?: SupabaseSession | null;
  profile?: UserProfile | null;
}

export interface TranscriptStats {
  transcript: string;
  total_words: number;
  accuracy: number;
  duration: number;
}

// Re-export policy types
export type {
  TranscriptionPolicy,
  TranscriptionMode,
} from '../../services/transcription/TranscriptionPolicy';

// Re-export policy values
export {
  buildPolicyForUser,
  PROD_FREE_POLICY,
  PROD_PRO_POLICY,
  E2E_DETERMINISTIC_NATIVE,
  E2E_DETERMINISTIC_CLOUD,
  E2E_DETERMINISTIC_PRIVATE,
} from '../../services/transcription/TranscriptionPolicy';