export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string
          user_id: string
          created_at: string
          updated_at: string
          title: string | null
          duration: number
          total_words: number
          filler_words: Json
          accuracy: number | null
          ground_truth: string | null
          transcript: string | null
          engine: string | null
          clarity_score: number | null
          wpm: number | null
          idempotency_key: string | null
          expires_at: string | null
          engine_version: string | null
          model_name: string | null
          device_type: string | null
          status: string | null
        }
        Insert: {
          id?: string
          user_id?: string
          created_at?: string
          updated_at?: string
          title?: string | null
          duration?: number
          total_words?: number
          filler_words?: Json
          accuracy?: number | null
          ground_truth?: string | null
          transcript?: string | null
          engine?: string | null
          clarity_score?: number | null
          wpm?: number | null
          idempotency_key?: string | null
          expires_at?: string | null
          engine_version?: string | null
          model_name?: string | null
          device_type?: string | null
          status?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          created_at?: string
          updated_at?: string
          title?: string | null
          duration?: number
          total_words?: number
          filler_words?: Json
          accuracy?: number | null
          ground_truth?: string | null
          transcript?: string | null
          engine?: string | null
          clarity_score?: number | null
          wpm?: number | null
          idempotency_key?: string | null
          expires_at?: string | null
          engine_version?: string | null
          model_name?: string | null
          device_type?: string | null
          status?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
