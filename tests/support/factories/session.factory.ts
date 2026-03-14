import crypto from 'node:crypto';
import type { Database } from '../../../frontend/src/types/database.types';

/**
 * Valid STT engines based on tier_configs
 */
export type STTEngine = 'native' | 'transformers-js' | 'whisper-turbo' | 'cloud' | 'private';

/**
 * Valid session statuses based on migrations
 */
export type SessionStatus = 'active' | 'completed' | 'expired';

/**
 * Type-safe Session Mock Interface (Derived from Database Schema)
 */
export type SessionRow = Database['public']['Tables']['sessions']['Row'];

// Extend the Row for UI-specific / Derived fields if needed (e.g. ai_suggestions which are JSONB in DB)
export interface MockSession extends Omit<SessionRow, 'filler_words' | 'ai_suggestions' | 'pause_metrics'> {
    filler_words: Record<string, { count: number }>;
    ai_suggestions?: {
        summary: string;
        suggestions: Array<{ title: string; description: string }>;
    } | null;
    pause_metrics?: {
        silencePercentage: number;
        transitionPauses: number;
        extendedPauses: number;
        longestPause: number;
    } | null;
    
    // Explicitly casting types that are strings in DB but enums in app
    engine: STTEngine | null;
    status: SessionStatus | null;
}

/**
 * Canonical factory for generating mock sessions.
 * Ensures schema synchronization across all E2E tests.
 */
export function createMockSession(
    overrides: Partial<MockSession> = {}
): MockSession {
    const now = new Date().toISOString();
    
    return {
        id: crypto.randomUUID(),
        user_id: 'mock-user-id',
        title: 'Test Session',
        duration: 300,
        total_words: 150,
        filler_words: {
            'um': { count: 2 },
            'uh': { count: 3 }
        },
        accuracy: 0.92,
        ground_truth: null,
        transcript: 'the birch canoe slid on the smooth planks',
        clarity_score: 88,
        wpm: 145,
        created_at: now,
        updated_at: now,
        
        // Phase 2 fields
        engine: 'private',
        engine_version: 'whisper-tiny.en-v1',
        model_name: 'whisper-tiny.en',
        device_type: 'wasm-cpu',
        status: 'completed',
        idempotency_key: crypto.randomUUID(),
        expires_at: null,
        
        // Optional UI fields
        ai_suggestions: null,
        pause_metrics: null,
        
        ...overrides,
    };
}
