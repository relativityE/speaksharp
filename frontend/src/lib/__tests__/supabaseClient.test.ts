import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Mock dependencies
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(),
}));

describe('supabaseClient.ts', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.resetModules();
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.unstubAllEnvs();
        delete window.supabase;
        vi.useRealTimers();
    });

    // Helper to re-import module to reset cachedClient
    const reImportModule = async () => {
        vi.resetModules();
        return await import('../supabaseClient');
    };

    it('should return window.supabase if it exists', async () => {
        const mockWindowClient = { auth: {} };
        window.supabase = mockWindowClient as unknown as SupabaseClient;

        const module = await reImportModule();
        const client = module.getSupabaseClient();

        expect(client).toBe(mockWindowClient);
    });

    it('should fail loudly if VITE_USE_MOCK_AUTH is true in the runtime app', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'true');
        vi.stubEnv('VITE_ALLOW_MOCK_AUTH_IN_TESTS', 'false');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://example.com');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key');

        const module = await reImportModule();

        expect(() => module.getSupabaseClient()).toThrow('Mock auth is not available from the runtime app');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('should create real client with valid env vars', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'false');
        vi.stubEnv('VITE_AUTH_MODE', 'real');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://real-project.supabase.co');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'real-key');

        const mockRealClient = { auth: {} };
        vi.mocked(createClient).mockReturnValue(mockRealClient as unknown as ReturnType<typeof createClient>);

        const module = await reImportModule();
        const client = module.getSupabaseClient();

        expect(createClient).toHaveBeenCalledWith(
            'https://real-project.supabase.co',
            'real-key',
            expect.objectContaining({
                auth: expect.objectContaining({
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true,
                })
            })
        );
        expect(client).toBe(mockRealClient);
    });

    it('should throw error if env vars are missing', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'false');
        vi.stubEnv('VITE_AUTH_MODE', 'real');
        vi.stubEnv('VITE_SUPABASE_URL', '');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

        const module = await reImportModule();

        expect(() => module.getSupabaseClient()).toThrow('Missing Supabase environment variables');
    });

    it('should fail loudly if real Supabase URL is paired with mock anon key', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'false');
        vi.stubEnv('VITE_AUTH_MODE', 'real');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://real-project.supabase.co');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'mock_anon_key');

        const module = await reImportModule();

        expect(() => module.getSupabaseClient()).toThrow('real Supabase URL is paired with a mock/test anon key');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('should return cached client on subsequent calls', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'false');
        vi.stubEnv('VITE_AUTH_MODE', 'real');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://real-project.supabase.co');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'real-key');

        const mockRealClient = { auth: {} };
        vi.mocked(createClient).mockReturnValue(mockRealClient as unknown as ReturnType<typeof createClient>);

        const module = await reImportModule();
        const client1 = module.getSupabaseClient();
        const client2 = module.getSupabaseClient();

        expect(createClient).toHaveBeenCalledTimes(1);
        expect(client1).toBe(client2);
    });
});
