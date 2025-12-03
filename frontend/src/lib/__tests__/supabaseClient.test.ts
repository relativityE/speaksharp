import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createMockSupabase } from '../mockSupabase';

// Mock dependencies
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(),
}));
vi.mock('../mockSupabase', () => ({
    createMockSupabase: vi.fn(),
}));

describe('supabaseClient.ts', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        // Reset cached client by reloading module? 
        // Since cachedClient is module-level variable, we might need to re-import or expose a reset function.
        // However, for unit tests, vitest isolates modules if we use vi.mock appropriately or resetModules.
        // But getSupabaseClient is imported at top level.
        // We might need to use dynamic import to test different env configurations properly.
    });

    afterEach(() => {
        process.env = originalEnv;
        delete window.supabase;
    });

    // Helper to re-import module to reset cachedClient
    const reImportModule = async () => {
        vi.resetModules();
        return await import('../supabaseClient');
    };

    it('should return window.supabase if it exists', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockWindowClient = { auth: {} } as any;
        window.supabase = mockWindowClient;

        const module = await reImportModule();
        const client = module.getSupabaseClient();

        expect(client).toBe(mockWindowClient);
    });

    it('should create mock client if VITE_USE_MOCK_AUTH is true', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'true');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://example.com');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key');

        const mockClient = { auth: {} };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(createMockSupabase).mockReturnValue(mockClient as any);

        const module = await reImportModule();
        const client = module.getSupabaseClient();

        expect(createMockSupabase).toHaveBeenCalled();
        expect(client).toBe(mockClient);
    });

    it('should create real client with valid env vars', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'false');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://real-project.supabase.co');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'real-key');

        const mockRealClient = { auth: {} };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(createClient).mockReturnValue(mockRealClient as any);

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
        vi.stubEnv('VITE_SUPABASE_URL', '');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

        const module = await reImportModule();

        expect(() => module.getSupabaseClient()).toThrow('Missing Supabase environment variables');
    });

    it('should return cached client on subsequent calls', async () => {
        vi.stubEnv('VITE_USE_MOCK_AUTH', 'false');
        vi.stubEnv('VITE_SUPABASE_URL', 'https://real-project.supabase.co');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'real-key');

        const mockRealClient = { auth: {} };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(createClient).mockReturnValue(mockRealClient as any);

        const module = await reImportModule();
        const client1 = module.getSupabaseClient();
        const client2 = module.getSupabaseClient();

        expect(createClient).toHaveBeenCalledTimes(1);
        expect(client1).toBe(client2);
    });
});
