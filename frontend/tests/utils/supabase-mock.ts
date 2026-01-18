/**
 * Supabase Mock Helper for Testing
 * 
 * Creates a mock that mimics Supabase's fluent/chained API.
 * All chain methods return `this` so they can be chained.
 * Terminal methods (single, maybeSingle) return the configured data/error.
 * 
 * Usage:
 *   const mock = createSupabaseMock({ id: '123' }, null);
 *   vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mock);
 */
import { vi } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';

export const createSupabaseMock = (returnData: unknown = null, error: unknown = null): SupabaseClient => {
    const chainMock = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: returnData, error }),
        maybeSingle: vi.fn().mockResolvedValue({ data: returnData, error }),
    };

    return chainMock as unknown as SupabaseClient;
};

/**
 * Creates a mock that errors on the specified method
 */
export const createSupabaseErrorMock = (errorCode: string, errorMessage: string): SupabaseClient => {
    return createSupabaseMock(null, { code: errorCode, message: errorMessage });
};

/**
 * Creates a mock for "not found" scenarios (PGRST116)
 */
export const createSupabaseNotFoundMock = (): SupabaseClient => {
    return createSupabaseErrorMock('PGRST116', 'Row not found');
};
