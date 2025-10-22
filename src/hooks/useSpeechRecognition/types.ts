import type { Session as SupabaseSession } from '@supabase/supabase-js';
import type { UserProfile } from '../../types/user';

export interface Chunk {
  text: string;
  id: number;
}

export interface WordConfidence {
  word: string;
  confidence: number;
}

export interface UseSpeechRecognitionProps {
  customWords?: string[];
  session?: SupabaseSession | null;
  profile?: UserProfile | null;
}

export interface TranscriptStats {
  transcript: string;
  total_words: number;
  wpm: number;
  clarity_score: number;
  accuracy: number;
  duration: number;
}

export interface ForceOptions {
  forceCloud?: boolean;
  forceOnDevice?: boolean;
  forceNative?: boolean;
}