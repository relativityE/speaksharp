/**
 * Supabase Test Client - Mode Switcher
 * 
 * Supports "Mock by Default, Real on Command" strategy:
 * - Default: Uses mock.supabase.co for safe local/CI testing
 * - Real Mode: Uses live Supabase when VITE_USE_LIVE_DB="true" (set by GitHub Action)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const getTestSupabaseClient = (): SupabaseClient => {
    // Check the flag injected by the GitHub Action
    const isLive = process.env.VITE_USE_LIVE_DB === 'true';

    let supabaseUrl: string;
    let supabaseKey: string;

    if (isLive) {
        console.log('🚨 CAUTION: Running against LIVE Supabase instance.');
        supabaseUrl = process.env.VITE_SUPABASE_URL || '';
        supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Use Service Role for admin setup if needed

        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Live mode requested but secrets are missing! Ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
        }
    } else {
        console.log('🧪 Running against MOCK Supabase.');
        supabaseUrl = 'https://mock.supabase.co';
        supabaseKey = 'mock_service_role_key';
    }

    return createClient(supabaseUrl, supabaseKey);
};

/**
 * Helper to check if we're in live mode
 */
export const isLiveMode = (): boolean => {
    return process.env.VITE_USE_LIVE_DB === 'true';
};

/**
 * Get test user credentials (only available in live mode via GitHub secrets)
 */
export const getTestCredentials = () => {
    const email = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
    const password = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

    if (!email || !password) {
        console.warn('⚠️ Test credentials not available. Set PRO_TEST_EMAIL/PRO_TEST_PASSWORD or legacy E2E_PRO_EMAIL/E2E_PRO_PASSWORD.');
    }

    return { email, password };
};
