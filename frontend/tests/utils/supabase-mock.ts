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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createSupabaseMock = (returnData: unknown = null, error: unknown = null): any => {
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

    return chainMock;
};

/**
 * Creates a mock that errors on the specified method
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createSupabaseErrorMock = (errorCode: string, errorMessage: string): any => {
    return createSupabaseMock(null, { code: errorCode, message: errorMessage });
};

/**
 * Creates a mock for "not found" scenarios (PGRST116)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createSupabaseNotFoundMock = (): any => {
    return createSupabaseErrorMock('PGRST116', 'Row not found');
};
