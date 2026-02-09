import { MOCK_USER, MOCK_USER_PROFILE, MOCK_SESSIONS } from '../../../tests/e2e/fixtures/mockData';
import logger from './logger';

export const createMockSupabase = () => {
    const listeners = new Set<(event: string, session: unknown) => void>();
    let currentSession: unknown = null;

    return {
        auth: {
            getSession: () => Promise.resolve({ data: { session: currentSession }, error: null }),
            onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
                listeners.add(callback);
                return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
            },
            signUp: ({ email }: Record<string, string>) => {
                // Simulate sign up
                const session = {
                    user: { ...MOCK_USER, email },
                    access_token: 'mock-token',
                };
                currentSession = session;
                listeners.forEach(l => l('SIGNED_IN', session));
                return Promise.resolve({ data: { user: MOCK_USER, session }, error: null });
            },
            signInWithPassword: ({ email }: Record<string, string>) => {
                // Simulate sign in
                const session = {
                    user: { ...MOCK_USER, email },
                    access_token: 'mock-token',
                };
                currentSession = session;
                listeners.forEach(l => l('SIGNED_IN', session));
                return Promise.resolve({ data: { user: MOCK_USER, session }, error: null });
            },
            signOut: () => {
                currentSession = null;
                listeners.forEach(l => l('SIGNED_OUT', null));
                return Promise.resolve({ error: null });
            },
        },
        from: (table: string) => ({
            select: () => ({
                eq: (column: string, value: unknown) => ({
                    single: () => {
                        if (table === 'user_profiles' && column === 'id' && value === MOCK_USER.id) {
                            return Promise.resolve({ data: MOCK_USER_PROFILE, error: null });
                        }
                        return Promise.resolve({ data: null, error: { message: 'Not found' } });
                    },
                    order: () => {
                        if (table === 'sessions' && column === 'user_id' && value === MOCK_USER.id) {
                            // Check for E2E empty state flag
                            const isEmpty = typeof window !== 'undefined' && '__E2E_EMPTY_SESSIONS__' in window && Boolean(window['__E2E_EMPTY_SESSIONS__' as keyof typeof window]);
                            logger.debug({ isEmpty }, '[MockSupabase] Checking __E2E_EMPTY_SESSIONS__');
                            if (isEmpty) {
                                return Promise.resolve({ data: [], error: null });
                            }
                            return Promise.resolve({ data: MOCK_SESSIONS, error: null });
                        }
                        return Promise.resolve({ data: [], error: null });
                    },
                }),
            }),
            insert: (data: unknown) => Promise.resolve({ data, error: null }),
            update: (data: unknown) => ({
                eq: () => Promise.resolve({ data, error: null }),
            }),
        }),
    };
};
