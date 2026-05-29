import { MOCK_USER, MOCK_USER_PROFILE, MOCK_SESSIONS } from '../../../tests/e2e/fixtures/mockData';
import logger from './logger';

const MOCK_SESSIONS_STORAGE_KEY = '__SS_MOCK_SESSIONS__';

const readSavedSessions = (): Array<Record<string, unknown>> => {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.sessionStorage.getItem(MOCK_SESSIONS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        logger.warn({ error }, '[MockSupabase] Failed to parse saved sessions');
        return [];
    }
};

const getMockProfile = () => {
    const profileOverride = typeof window !== 'undefined'
        ? (window as Window & { __MOCK_PROFILE__?: Partial<typeof MOCK_USER_PROFILE> }).__MOCK_PROFILE__
        : undefined;

    return {
        ...MOCK_USER_PROFILE,
        ...(profileOverride || {}),
    };
};

export const createMockSupabase = () => {
    const listeners = new Set<(event: string, session: unknown) => void>();
    let currentSession: unknown = null;
    const savedSessions: Array<Record<string, unknown>> = readSavedSessions();

    const persistSavedSessions = () => {
        if (typeof window === 'undefined') return;

        try {
            window.sessionStorage.setItem(MOCK_SESSIONS_STORAGE_KEY, JSON.stringify(savedSessions));
        } catch (error) {
            logger.warn({ error }, '[MockSupabase] Failed to persist saved sessions');
        }
    };

    const getStoredSession = (): unknown => {
        if (currentSession || typeof window === 'undefined') return currentSession;

        const authKey = Object.keys(window.localStorage)
            .find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (!authKey) return null;

        try {
            currentSession = JSON.parse(window.localStorage.getItem(authKey) || 'null');
            return currentSession;
        } catch (error) {
            logger.warn({ error, authKey }, '[MockSupabase] Failed to parse stored auth session');
            return null;
        }
    };

    const getSessions = () => {
        const isEmpty = typeof window !== 'undefined' && '__E2E_EMPTY_SESSIONS__' in window && Boolean(window['__E2E_EMPTY_SESSIONS__' as keyof typeof window]);
        const baseline = isEmpty ? [] : MOCK_SESSIONS;
        return [...savedSessions, ...baseline];
    };

    const createSessionsQuery = () => {
        const filters: Array<{ column: string; value: unknown }> = [];
        let maxRows: number | null = null;

        const getFilteredSessions = () => {
            let sessions = getSessions();
            for (const filter of filters) {
                sessions = sessions.filter(session => session[filter.column] === filter.value);
            }
            return maxRows === null ? sessions : sessions.slice(0, maxRows);
        };

        const query = {
            eq: (column: string, value: unknown) => {
                filters.push({ column, value });
                return query;
            },
            or: () => query,
            order: () => query,
            limit: (limit: number) => {
                maxRows = limit;
                return Promise.resolve({ data: getFilteredSessions(), error: null });
            },
            range: () => Promise.resolve({ data: getFilteredSessions(), error: null }),
            single: () => {
                const sessions = getFilteredSessions();
                return Promise.resolve({ data: sessions[0] || null, error: sessions[0] ? null : { code: 'PGRST116', message: 'Not found' } });
            },
            then: (resolve: (value: { data: readonly unknown[]; count: number; error: null }) => unknown) =>
                Promise.resolve({ data: getFilteredSessions(), count: getFilteredSessions().length, error: null }).then(resolve),
        };
        return query;
    };

    return {
        auth: {
            getSession: () => {
                const session = getStoredSession();
                const checkSessionIdentity = (session: unknown) => {
                    const s = session as { user?: { id?: string } };
                    logger.debug({ 
                        userId: s?.user?.id,
                        isActive: !!session,
                        role: getMockProfile().subscription_status,
                        timestamp: Date.now() 
                    }, '[AUTH STATE]');
                };
                checkSessionIdentity(session);
                return Promise.resolve({ data: { session }, error: null });
            },
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
        rpc: (fn: string, params: Record<string, unknown>) => {
            if (fn === 'create_session_and_update_usage') {
                const sessionData = (params.p_session_data || {}) as Record<string, unknown>;
                const newSession = {
                    id: `session-e2e-${Date.now()}-${savedSessions.length + 1}`,
                    created_at: new Date().toISOString(),
                    duration: 0,
                    total_words: 0,
                    filler_words: {},
                    status: 'active',
                    ...sessionData,
                    engine: params.p_engine_type || sessionData.engine || 'native',
                    engine_version: params.p_engine_version || null,
                    model_name: params.p_model_name || null,
                    device_type: params.p_device_type || null,
                };
                savedSessions.unshift(newSession);
                persistSavedSessions();
                return Promise.resolve({ data: { new_session: newSession, usage_exceeded: false }, error: null });
            }

            if (fn === 'complete_session') {
                const sessionId = params.p_session_id;
                const session = savedSessions.find(item => item.id === sessionId);
                if (session) {
                    session.status = params.p_status || 'completed';
                    if (typeof params.p_final_transcript === 'string') {
                        session.transcript = params.p_final_transcript;
                    }
                    if (typeof params.p_final_duration === 'number') {
                        session.duration = params.p_final_duration;
                    }
                    persistSavedSessions();
                }
                return Promise.resolve({ data: { success: true }, error: null });
            }

            if (fn === 'heartbeat_session') {
                return Promise.resolve({ data: { success: true }, error: null });
            }

            return Promise.resolve({ data: null, error: { message: `Unsupported mock RPC: ${fn}` } });
        },
        from: (table: string) => ({
            select: () => table === 'sessions' ? createSessionsQuery() : ({
                eq: (column: string, value: unknown) => ({
                    single: () => {
                        if (table === 'user_profiles' && column === 'id' && value === MOCK_USER.id) {
                            return Promise.resolve({ data: getMockProfile(), error: null });
                        }
                        return Promise.resolve({ data: null, error: { message: 'Not found' } });
                    },
                    order: () => {
                        if (table === 'sessions' && column === 'user_id' && value === MOCK_USER.id) {
                            // Check for E2E empty state flag
                            const isEmpty = typeof window !== 'undefined' && '__E2E_EMPTY_SESSIONS__' in window && Boolean(window['__E2E_EMPTY_SESSIONS__' as keyof typeof window]);
                            logger.debug({ isEmpty }, '[MockSupabase] Checking __E2E_EMPTY_SESSIONS__');
                            if (isEmpty) {
                                return Promise.resolve({ data: savedSessions, error: null });
                            }
                            return Promise.resolve({ data: getSessions(), error: null });
                        }
                        return Promise.resolve({ data: [], error: null });
                    },
                }),
            }),
            insert: (data: unknown) => Promise.resolve({ data, error: null }),
            update: (data: unknown) => ({
                eq: (column: string, value: unknown) => {
                    if (table === 'sessions' && column === 'id') {
                        const session = savedSessions.find(item => item.id === value);
                        if (session) {
                            Object.assign(session, data);
                            persistSavedSessions();
                        }
                    }
                    return Promise.resolve({ data, error: null });
                },
            }),
        }),
    };
};
