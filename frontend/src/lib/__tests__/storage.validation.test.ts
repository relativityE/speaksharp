import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveSession } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import type { PracticeSession } from '../../types/session';
import type { UserProfile } from '../../types/user';

// Mock dependencies
vi.mock('../supabaseClient', () => ({
    getSupabaseClient: vi.fn(),
}));

vi.mock('../logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('storage.ts validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should throw an error if transcript exceeds MAX_TRANSCRIPT_LENGTH', async () => {
        const mockUser = {
            id: 'user-123',
            email: 'test@example.com',
            subscription_status: 'free',
        };

        // Create a massive string > 500KB
        const massiveTranscript = 'a'.repeat(500001);

        const sessionData = {
            user_id: mockUser.id,
            transcript: massiveTranscript,
            duration: 60,
        } as Partial<PracticeSession> & { user_id: string };

        await expect(saveSession(sessionData, mockUser as unknown as UserProfile))
            .rejects
            .toThrow(/Transcript too long/);
    });

    it('should pass if transcript is within limits', async () => {
        const mockUser = {
            id: 'user-123',
            email: 'test@example.com',
            subscription_status: 'free',
        };

        const validTranscript = 'a'.repeat(500);

        const sessionData = {
            user_id: mockUser.id,
            transcript: validTranscript,
            duration: 60,
        } as Partial<PracticeSession> & { user_id: string };

        // Mock successful RPC call
        const mockRpc = vi.fn().mockResolvedValue({
            data: { new_session: { id: 'session-1' }, usage_exceeded: false },
            error: null
        });

        vi.mocked(getSupabaseClient).mockReturnValue({
            rpc: mockRpc
        } as unknown as ReturnType<typeof getSupabaseClient>);

        const result = await saveSession(sessionData, mockUser as unknown as UserProfile);
        expect(result.session).toBeDefined();
        expect(mockRpc).toHaveBeenCalled();
    });
});
