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
}

export interface UseSpeechRecognitionProps {
  customWords?: string[];
  session?: SupabaseSession | null;
  profile?: UserProfile | null;
}

export interface TranscriptStats {
  transcript: string;
  total_words: number;
  accuracy: number;
  duration: number;
}