import { createClient } from '@supabase/supabase-js';
import logger from './logger';

let supabaseInstance = null;

function initializeSupabase() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    const errorMessage = "Supabase URL and Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.";
    logger.error(errorMessage);
    // In a test environment, we don't want to throw an error, as the app will be stubbed.
    // We can show a less disruptive error to the user.
    if (import.meta.env.MODE !== 'test') {
      throw new Error(errorMessage);
    }
    // Return a mock object in test mode if variables are missing,
    // allowing stubs to take over.
    return {
      auth: {
        onAuthStateChange: () => ({ data: { subscription: () => {} } }),
        getSession: () => Promise.resolve({ data: { session: null } }),
      },
      from: () => ({
        select: () => Promise.resolve({ data: [], error: null }),
        insert: () => Promise.resolve({ data: [], error: null }),
      }),
    };
  }

  const isTest = import.meta.env.MODE === 'test';

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: !isTest,
      persistSession: !isTest,
      detectSessionInUrl: !isTest,
    },
  });

  return supabaseInstance;
}

// Use a proxy to lazily initialize the Supabase client on first access.
// This is a more robust solution than hoping the timing works out.
export const supabase = new Proxy({}, {
  get: function(target, prop) {
    const client = initializeSupabase();
    // This is a workaround for a potential issue where Vitest's mock detection
    // might interact strangely with the proxy.
    if (prop === 'then') {
        return undefined;
    }
    const property = client[prop];

    if (typeof property === 'function') {
      return property.bind(client);
    }
    return property;
  }
});
