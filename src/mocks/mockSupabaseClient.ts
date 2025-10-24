// src/mocks/mockSupabaseClient.ts
(() => {
  if ((window as any).__MOCK_SUPABASE_CLIENT_INITIALIZED__) {
    return;
  }
  (window as any).__MOCK_SUPABASE_CLIENT_INITIALIZED__ = true;

  let session: any = null;
  const listeners = new Set<(event: string, session: any | null) => void>();

  const mockSupabaseClient = {
    auth: {
      onAuthStateChange: (callback: (event: string, session: any | null) => void) => {
        listeners.add(callback);
        callback('INITIAL_SESSION', null);
        return {
          data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
        };
      },
      setSession: async (sessionData: any) => {
        session = { ...sessionData, expires_at: Math.floor(Date.now() / 1000) + 3600 };
        await Promise.resolve();
        listeners.forEach(listener => listener('SIGNED_IN', session));
        return { data: { session, user: session!.user }, error: null };
      },
      signOut: async () => {
        session = null;
        await Promise.resolve();
        listeners.forEach(listener => listener('SIGNED_OUT', null));
        return { error: null };
      },
      getSession: async () => {
        return { data: { session }, error: null };
      }
    },
    from: (table: any) => ({
      select: (columns = '*') => ({
        eq: (column: any, value: any) => {
            if (table === 'user_profiles') {
                return Promise.resolve({ data: { id: 'test-user-123', subscription_status: 'pro', preferred_mode: 'cloud' }, error: null });
            }
            return Promise.resolve({ data: [], error: null })
        },
        single: () => {
            if (table === 'user_profiles') {
                return Promise.resolve({ data: { id: 'test-user-123', subscription_status: 'pro', preferred_mode: 'cloud' }, error: null });
            }
            return Promise.resolve({ data: {}, error: null })
        },
      }),
    }),
  };

  (window as any).supabase = mockSupabaseClient;
})();
