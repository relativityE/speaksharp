import { type Page } from '@playwright/test';

/**
 * SSE2EManifest — Unified bridge for E2E orchestration.
 */
export interface SSE2EManifest {
  isActive: boolean;
  enableRealEngine?: boolean;
  isEngineInitialized?: boolean;
  engineType?: 'mock' | 'real' | 'system';
  debug?: boolean;
  flags?: Record<string, unknown>;
  registry?: Record<string, unknown>;
  realEngineRegistryKeys?: string[];
  forbiddenEngineKeys?: string[];
  MOCK_STT_AVAILABILITY?: boolean;
  guestStatus?: 'free' | 'pro';
  emitTranscript?: (text: string, isFinal?: boolean) => void;
  onStateChange?: (cb: (state: string) => void) => (() => void) | void;
  destroyService?: () => Promise<void>;
  getFSMState?: () => string;
  startRecording?: () => void;
  stopRecording?: () => void;
  lastTranscript?: string;
  runtimeEventLog?: Array<{ event: string; instanceId: string; timestamp: number }>;
  pushEvent?: (event: string, instanceId: string) => void;
  _activeCallbacks?: {
    onTranscriptUpdate?: (update: {
      transcript: { partial?: string; final?: string };
      isFinal: boolean;
      isPartial: boolean;
      timestamp: number;
    }) => void;
  } | null;
}

export interface ProgressFixtures {
  evaluations: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  /** Minimal session chronology rows used only by the Progress reference-validation query. */
  chronology?: Array<Record<string, unknown>>;
}

/**
 * Minimal interface for the controller to avoid importing the full class.
 */
interface ControllerBridge {
  service?: {
    strategy?: {
      emitTranscript?: (text: string, isFinal: boolean) => void;
    };
    isTerminated: boolean;
  };
  handleTranscriptUpdate?: (update: {
    transcript: { partial?: string; final?: string };
    isFinal: boolean;
    isPartial: boolean;
    timestamp: number;
  }) => void;
}

/**
 * E2EWindow — Extended window for Playwright bridge.
 * 🛡️ We DO NOT extend Window here to avoid type conflicts with global.d.ts definitions.
 */
export interface E2EWindow {
  __SS_E2E__: SSE2EManifest;
  __SS_E2E_ACTIVE_ENGINE__?: unknown;
  __SS_E2E_ENGINE_CACHE__?: Record<string, unknown>;
  __SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__?: Array<{ key: string; phase: string; at: number }>;
  __SS_E2E_FORBIDDEN_ENGINE_GUARD__?: { installed: boolean; protectedKeys: string[] };
  __SS_E2E_DEBUG__?: Record<string, unknown>;
  __MODEL_CACHED__?: boolean;
  __SS_E2E_BRIDGE__?: {
    emitTranscript: (text: string, isFinal?: boolean) => void;
  };
  __APP_READY_STATE__?: Record<string, boolean>;
  __E2E_READY__?: boolean;
  __E2E_LOG_LEVEL__?: string;
  __E2E_FINISH_DOWNLOAD__?: (() => void) | null;
  __WASM_LOADED__?: boolean;
  dispatchMockTranscript?: (text: string, isFinal: boolean) => void;
  ENV?: { isE2E: boolean };
  SSE_ENV?: { isE2E: boolean };
  TEST_MODE?: boolean;
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  MockPrivateWhisper?: unknown;
  __activeSpeechRecognition?: unknown;
  __e2eBridgeReady__?: boolean;
  __MOCK_PROFILE__?: Record<string, unknown> & { subscription_status: string };
  __TRANSCRIPTION_SERVICE__?: ControllerBridge;
  supabase?: unknown;
  localStorage: Storage;
  location: Location;
  setInterval: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number;
}

/**
 * setupE2EManifest — Atomic T=0 injection.
 */
export async function setupE2EManifest(
  page: Page,
  config: {
    engineType?: 'mock' | 'real' | 'system';
    enableRealEngine?: boolean;
    flags?: { bypassMutex?: boolean; fastTimers?: boolean };
    debug?: boolean;
    realEngineRegistryKeys?: string[];
    /**
     * #1037: engine keys that MUST NOT be constructed during a Browser/Web-Speech journey. Their registry
     * factories are replaced with tripwires ATOMICALLY as the registry is built (not via a later interval),
     * so the guard is authoritative before any application module can call STTRegistry.getEngine.
     */
    forbiddenEngineKeys?: string[];
    storage?: Record<string, string>;
    userType?: 'free' | 'pro';
    mockProfile?: Record<string, unknown>;
    emptySessions?: boolean;
    /** #1047: seed the in-browser mock session DB (e.g. transcript_state variants) instead of defaults. */
    sessions?: Array<Record<string, unknown>>;
    /** #1047 U3: seed the same in-browser Supabase authority used by the Progress product path. */
    progressFixtures?: ProgressFixtures;
  }
) {
  const { storage = {}, userType = 'free', mockProfile, emptySessions = false, sessions, progressFixtures, ...manifest } = config;
  
  // 🛡️ Fix 5: Analytics Mock (Mandated Stabilization)
  // Decouples telemetry from UI readiness to prevent network-induced flakiness
  await page.route('**/telemetry/**', route => route.fulfill({ status: 200, body: '{}' }));

  // Some transpiled Playwright init callbacks reference esbuild's __name helper
  // before the callback body executes. Seed it as a global no-op first so
  // browser-side init scripts never fail before the E2E manifest is installed.
  await page.addInitScript(`
    var __name = globalThis.__name || ((target, name) => target);
    globalThis.__name = __name;
  `);

  await page.addInitScript(({ m, s, ut, mp, es, seed, progress }: { m: unknown; s: Record<string, string>; ut: string; mp?: Record<string, unknown>; es?: boolean; seed?: Array<Record<string, unknown>>; progress?: ProgressFixtures }) => {
    // Playwright serializes this callback into the browser. Some TS/esbuild
    // transforms preserve function names by emitting __name(...) calls inside
    // the serialized body, but the helper itself is otherwise outside that
    // body. Keep a local no-op helper so browser init never trips ReferenceError.
    const __name = <T,>(target: T, name: string): T => {
      void name;
      return target;
    };
    void __name;

    // 0. AUTHORITATIVE TIER SIGNAL
    const win = window as unknown as E2EWindow;
    win.__MOCK_PROFILE__ = { 
      subscription_status: ut === 'pro' ? 'pro' : 'free',
      stripe_subscription_id: ut === 'pro' ? 'sub_e2e_pro_cloud' : null,
      subscription_id: ut === 'pro' ? 'sub_e2e_pro_cloud' : null,
      ...(mp || {})
    };

    const localBrowserStorage = s;

    // 1. CLEAR: Strict Zero baseline with Origin Guard
    try {
      if (win.location.origin !== 'null' && win.location.origin !== 'about:blank') {
        win.localStorage.clear();
      }
    } catch (err) {
      console.warn('[E2E] localStorage.clear failed in setupE2EManifest', err);
    }

    // 2. STORAGE: Re-inject tokens
    Object.entries(localBrowserStorage).forEach(([key, val]) => {
      try {
        win.localStorage.setItem(key, val);
      } catch (err) {
        console.warn(`[E2E] localStorage.setItem failed for key ${key}`, err);
      }
    });

    const authSession = (() => {
      for (const value of Object.values(localBrowserStorage)) {
        try {
          const parsed = JSON.parse(value);
          if (parsed?.access_token && parsed?.user?.id) return parsed;
        } catch {
          // Keep scanning; unrelated storage values may be present.
        }
      }
      return null;
    })();

    const e2eProfile = {
      id: authSession?.user?.id || '__E2E_GUEST_USER__',
      subscription_status: ut === 'pro' ? 'pro' : 'free',
      stripe_subscription_id: ut === 'pro' ? 'sub_e2e_paid_pro' : null,
      subscription_id: ut === 'pro' ? 'sub_e2e_paid_pro' : null,
      usage_seconds: 0,
      usage_reset_date: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
      ...(mp || {}),
    };

    const nowIso = () => new Date().toISOString();
    // #1306 metrics-only: the mock DB mirrors the metrics-only persistence FIREWALL. A transcript,
    // transcript_state, ai_suggestions, per-session custom_words, accuracy, or the legacy nested filler_words is
    // FORBIDDEN. The mock REJECTS such a write fail-closed (exactly as the Stage B DB firewall RAISEs) — it does
    // NOT silently sanitize it, because silently dropping a forbidden field would HIDE a real client privacy
    // regression. A valid row carries flat filler_counts + one next_action_signal.
    const DEFAULT_NEXT_ACTION = {
      reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
      value: 5, comparator: 'above_target', templateVersion: 'rec_v1',
    } as const;
    const FORBIDDEN_CONTENT_FIELDS = ['transcript', 'transcript_state', 'ai_suggestions', 'ground_truth', 'accuracy', 'custom_words', 'filler_words'];
    const forbiddenKeyIn = (payload: unknown): string | null => {
      if (!payload || typeof payload !== 'object') return null;
      for (const k of FORBIDDEN_CONTENT_FIELDS) if (k in (payload as Record<string, unknown>)) return k;
      return null;
    };
    // Fail-closed guard for a `sessions` write. Returns a Supabase-shaped error result when a forbidden content
    // field is present (single payload or array), else null. The field NAME is a fixed schema identifier (never
    // user prose), so naming it is safe and diagnostic.
    const rejectForbiddenSessionWrite = (payload: unknown): { data: null; error: { message: string; code: string }; count: number } | null => {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        const bad = forbiddenKeyIn(row);
        if (bad) {
          return { data: null, error: { message: `#1306 metrics-only firewall: forbidden content field "${bad}" rejected`, code: '23514' }, count: 0 };
        }
      }
      return null;
    };
    const makeSession = (overrides: Record<string, unknown> = {}) => {
      const status = (overrides.status as string) ?? 'completed';
      const row: Record<string, unknown> = {
        id: `session-${Math.random().toString(36).slice(2)}`,
        user_id: e2eProfile.id,
        title: 'Test Session',
        duration: 300,
        total_words: 150,
        filler_counts: { um: 2, uh: 3 },
        clarity_score: 88,
        wpm: 145,
        engine: 'private',
        status,
        // A completed session MUST carry exactly one next action; incomplete/failed carry none.
        next_action_signal: status === 'completed' ? DEFAULT_NEXT_ACTION : null,
        pause_metrics: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        ...overrides,
      };
      return row;
    };

    const e2eDbStorageKey = '__SS_E2E_SESSION_DB__';
    // #1047: an explicit seed (transcript_state variants) replaces the generic history. Each seeded row is
    // stamped with the authenticated user's id so the app's `.eq('user_id', …)` query returns it.
    const seededSessions = Array.isArray(seed) && seed.length > 0
      ? seed.map((row) => makeSession({ ...row, user_id: e2eProfile.id }))
      : null;
    const defaultSessions = es
      ? []
      : (seededSessions ?? Array.from({ length: 5 }, (_, index) => makeSession({
          id: `session-${index + 1}`,
          title: `Practice Session ${index + 1}`,
          created_at: new Date(Date.now() - index * 86400000).toISOString(),
        })));
    const loadPersistedSessions = () => {
      try {
        const raw = window.sessionStorage.getItem(e2eDbStorageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.sessions) ? parsed.sessions : null;
      } catch {
        return null;
      }
    };
    const persistSessions = () => {
      try {
        window.sessionStorage.setItem(e2eDbStorageKey, JSON.stringify({ sessions: sessionState.sessions }));
      } catch {
        // Non-fatal in E2E; the in-memory state still works until the next full navigation.
      }
    };
    const sessionState = {
      // Empty-session proofs must be a hard empty state. Reusing persisted
      // sessionStorage here lets earlier seeded analytics flows contaminate
      // `emptyUserPage` and hides the actual empty-state UX.
      // #1047 reload fidelity: a PERSISTED mock DB wins over the seed, so a page.reload() reads the
      // round-tripped rows (proving persistence) instead of re-seeding. The explicit seed applies only on the
      // FIRST load (no persisted DB yet); a fresh page (new test) starts with empty sessionStorage.
      sessions: es ? defaultSessions : (loadPersistedSessions() ?? seededSessions ?? defaultSessions),
    };
    let userGoals = {
      user_id: e2eProfile.id,
      weekly_goal: 5,
      clarity_goal: 90,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    let userFillerWords: Array<{ id: string; user_id: string; word: string; created_at: string }> = [];
    persistSessions();

    type QueryFilter = { column: string; value: unknown; operator?: 'eq' | 'in' | 'lt' | 'neq' };
    const matchesFilters = (row: Record<string, unknown>, filters: QueryFilter[]) => filters.every((filter) => {
      const value = row[filter.column];
      if (filter.operator === 'in') return Array.isArray(filter.value) && filter.value.some((candidate) => String(candidate) === String(value));
      if (filter.operator === 'lt') return String(value) < String(filter.value);
      if (filter.operator === 'neq') return String(value) !== String(filter.value);
      return String(value) === String(filter.value);
    });
    const queryResultFor = (
      table: string,
      single: boolean = false,
      filters: QueryFilter[] = [],
      options: { count?: string; head?: boolean; range?: [number, number] } = {}
    ) => {
      if (table === 'user_profiles') {
        return Promise.resolve({ data: single ? e2eProfile : [e2eProfile], error: null, count: 1 });
      }
      if (table === 'user_goals') {
        return Promise.resolve({ data: single ? userGoals : [userGoals], error: null, count: 1 });
      }
      if (table === 'user_filler_words') {
        const rows = userFillerWords.filter((row) =>
          matchesFilters(row as Record<string, unknown>, filters)
        );
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length });
      }
      const progressRows = table === 'session_progress_evaluations' ? progress?.evaluations
        : table === 'progress_recommendations' ? progress?.recommendations
          : table === 'progress_recommendation_attempts' ? progress?.attempts
            : null;
      if (progressRows) {
        const rows = progressRows.filter((row) => matchesFilters(row, filters));
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length });
      }
      if (table === 'sessions') {
        let rows = [...sessionState.sessions];
        // Progress validates its persisted ids with one `id IN (...)` chronology read. Keep those
        // minimal authority rows out of normal History/Analytics queries so a comparison fixture does
        // not silently become a second customer-visible session.
        const isProgressChronologyRead = filters.some((filter) => filter.column === 'id' && filter.operator === 'in');
        if (isProgressChronologyRead && progress?.chronology) {
          const existingIds = new Set(rows.map((row) => String(row.id)));
          rows.push(...progress.chronology.filter((row) => !existingIds.has(String(row.id))) as typeof rows);
        }
        for (const filter of filters) {
          rows = rows.filter((row) => matchesFilters(row as Record<string, unknown>, [filter]));
        }
        rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        const count = rows.length;
        if (options.range) {
          const [from, to] = options.range;
          rows = rows.slice(from, to + 1);
        }
        if (single) {
          const row = rows[0] ?? null;
          return Promise.resolve({
            data: row,
            error: row ? null : { code: 'PGRST116', message: 'No rows returned' },
            count,
          });
        }
        return Promise.resolve({ data: options.head ? null : rows, error: null, count });
      }
      return Promise.resolve({ data: single ? null : [], error: null, count: 0 });
    };

    const makeQueryBuilder = (table: string) => {
      const filters: QueryFilter[] = [];
      const options: { count?: string; head?: boolean; range?: [number, number] } = {};
      let pendingMutation: { type: 'update' | 'insert' | 'upsert' | 'delete'; payload?: Record<string, unknown> | Record<string, unknown>[] } | null = null;
      const commitMutation = () => {
        if (!pendingMutation) return null;
        if (table === 'user_goals' && pendingMutation.type === 'upsert') {
          const payload = Array.isArray(pendingMutation.payload) ? pendingMutation.payload[0] ?? {} : pendingMutation.payload ?? {};
          userGoals = { ...userGoals, ...payload, user_id: String(payload.user_id || userGoals.user_id), updated_at: nowIso() };
          return { data: [userGoals], error: null, count: 1 };
        }
        if (table === 'user_filler_words') {
          const matching = userFillerWords.filter((row) =>
            filters.every((filter) => String((row as Record<string, unknown>)[filter.column]) === String(filter.value))
          );
          if (pendingMutation.type === 'insert') {
            const payloads = Array.isArray(pendingMutation.payload) ? pendingMutation.payload : [pendingMutation.payload || {}];
            const inserted = payloads.map((payload, index) => ({
              id: String(payload.id || `user-word-${Date.now()}-${index}`),
              user_id: String(payload.user_id || e2eProfile.id),
              word: String(payload.word || '').toLowerCase().trim(),
              created_at: String(payload.created_at || nowIso()),
            })).filter((row) => row.word.length > 0);
            userFillerWords.push(...inserted);
            return { data: inserted, error: null, count: inserted.length };
          }
          if (pendingMutation.type === 'delete') {
            userFillerWords = userFillerWords.filter((row) => !matching.includes(row));
            return { data: matching, error: null, count: matching.length };
          }
        }
        if (table !== 'sessions') return null;
        if (pendingMutation.type === 'insert') {
          // #1306 metrics-only firewall: REJECT a forbidden content field fail-closed (never silently drop it,
          // which would hide a client privacy regression). Mirrors the Stage B DB CHECK/trigger.
          const rejected = rejectForbiddenSessionWrite(pendingMutation.payload);
          if (rejected) return rejected;
          const payloads = Array.isArray(pendingMutation.payload) ? pendingMutation.payload : [pendingMutation.payload || {}];
          const inserted = payloads.map((payload) => makeSession(payload as Record<string, unknown>));
          sessionState.sessions.unshift(...inserted);
          persistSessions();
          return { data: inserted, error: null, count: inserted.length };
        }
        const matching = sessionState.sessions.filter((row) =>
          filters.every((filter) => String((row as Record<string, unknown>)[filter.column]) === String(filter.value))
        );
        if (pendingMutation.type === 'update') {
          const rejected = rejectForbiddenSessionWrite(pendingMutation.payload);
          if (rejected) return rejected;
          for (const row of matching) {
            Object.assign(row, (pendingMutation.payload || {}) as Record<string, unknown>, { updated_at: nowIso() });
          }
          persistSessions();
          return { data: matching, error: null, count: matching.length };
        }
        if (pendingMutation.type === 'delete') {
          sessionState.sessions = sessionState.sessions.filter((row) => !matching.includes(row));
          persistSessions();
          return { data: matching, error: null, count: matching.length };
        }
        return null;
      };
      const builder = {
        select: (_columns?: string, selectOptions?: { count?: string; head?: boolean }) => {
          options.count = selectOptions?.count;
          options.head = selectOptions?.head;
          // #1306: the metrics-only read firewall is a property of the COLUMN LIST the client asks for.
          // Under this double no HTTP is issued, so a network-body scan proves nothing; recording the
          // requested columns is the only layer at which the claim is actually observable.
          if (table === 'sessions' && typeof _columns === 'string') {
            const sink = win as unknown as { __e2eSessionSelects__?: string[] };
            (sink.__e2eSessionSelects__ ??= []).push(_columns);
          }
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push({ column, value, operator: 'eq' });
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          filters.push({ column, value: values, operator: 'in' });
          return builder;
        },
        lt: (column: string, value: unknown) => {
          filters.push({ column, value, operator: 'lt' });
          return builder;
        },
        neq: (column: string, value: unknown) => {
          filters.push({ column, value, operator: 'neq' });
          return builder;
        },
        or: () => builder,
        order: () => builder,
        range: (from: number, to: number) => {
          options.range = [from, to];
          return builder;
        },
        limit: (count: number) => {
          options.range = [0, Math.max(0, count - 1)];
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          pendingMutation = { type: 'update', payload };
          return builder;
        },
        insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
          pendingMutation = { type: 'insert', payload };
          return builder;
        },
        upsert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
          pendingMutation = { type: 'upsert', payload };
          return builder;
        },
        delete: () => {
          pendingMutation = { type: 'delete' };
          return builder;
        },
        single: () => {
          const mutationResult = commitMutation();
          if (mutationResult) return Promise.resolve({ ...mutationResult, data: Array.isArray(mutationResult.data) ? mutationResult.data[0] ?? null : mutationResult.data });
          return queryResultFor(table, true, filters, options);
        },
        maybeSingle: () => {
          const mutationResult = commitMutation();
          if (mutationResult) return Promise.resolve({ ...mutationResult, data: Array.isArray(mutationResult.data) ? mutationResult.data[0] ?? null : mutationResult.data });
          return queryResultFor(table, true, filters, options);
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(commitMutation() ?? queryResultFor(table, false, filters, options)).then(resolve, reject),
      };
      return builder;
    };

    const buildUsageLimitResponse = () => {
      const profile = e2eProfile as Record<string, unknown>;
      const userType = String(profile.subscription_status || 'free');
      const isPro = userType === 'pro';

      return {
        can_start: profile.can_start !== false,
        subscription_status: userType,
        is_pro: isPro,
        trial_active: profile.trial_active ?? !isPro,
        trial_expires_at: profile.trial_expires_at ?? null,
        user_type: userType,
        streak_count: 0,
      };
    };

    // Mutable session + listener registry so the REAL AuthPage form (signInWithPassword / signUp) can
    // drive the actual account-access composition end-to-end — the auth backend is mocked at the client
    // layer (like every other Supabase call here), NOT stubbed by seeding a session. Anonymous boots start
    // with the storage-derived session (null); form auth then flips it and re-notifies AuthProvider.
    let currentSession: typeof authSession = authSession;
    const authListeners: Array<(event: string, session: unknown) => void> = [];
    const synthUser = (email?: string) => ({
      id: e2eProfile.id,
      email: email || 'e2e@example.com',
      app_metadata: { provider: 'email', subscription_status: e2eProfile.subscription_status },
      user_metadata: {},
      aud: 'authenticated',
      role: 'authenticated',
      created_at: e2eProfile.created_at,
    });
    const synthSession = (email?: string) => ({
      access_token: 'e2e-form-auth-access',
      refresh_token: 'e2e-form-auth-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: synthUser(email),
    });

    win.supabase = {
      auth: {
        getSession: async () => ({ data: { session: currentSession }, error: null }),
        getUser: async () => ({ data: { user: currentSession?.user ?? null }, error: null }),
        onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
          authListeners.push(callback);
          setTimeout(() => callback('INITIAL_SESSION', currentSession), 0);
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  const i = authListeners.indexOf(callback);
                  if (i >= 0) authListeners.splice(i, 1);
                },
              },
            },
          };
        },
        signInWithPassword: async ({ email }: { email?: string } = {}) => {
          currentSession = synthSession(email);
          authListeners.forEach((cb) => cb('SIGNED_IN', currentSession));
          return { data: { user: currentSession.user, session: currentSession }, error: null };
        },
        signUp: async ({ email }: { email?: string } = {}) => {
          // Mirror the app flow: signUp succeeds without a session; AuthPage then calls signInWithPassword.
          return { data: { user: synthUser(email), session: null }, error: null };
        },
        signOut: async () => {
          currentSession = null;
          authListeners.forEach((cb) => cb('SIGNED_OUT', null));
          return { error: null };
        },
      },
      from: (table: string) => makeQueryBuilder(table),
      functions: {
        invoke: async (name: string) => {
          if (name === 'check-usage-limit') {
            const data = buildUsageLimitResponse();
            win.__SS_E2E_DEBUG__ = {
              ...(win.__SS_E2E_DEBUG__ || {}),
              usageLimit: data,
              usageLimitSource: 'window.supabase.functions.invoke',
            };
            return { data, error: null };
          }
          return { data: { success: true }, error: null };
        },
      },
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === 'create_session_and_update_usage') {
          const sessionData = (args?.p_session_data || {}) as Record<string, unknown>;
          // #1306 firewall: a create RPC whose session payload smuggles a forbidden content field is REJECTED.
          const rejected = rejectForbiddenSessionWrite(sessionData);
          if (rejected) return { data: null, error: rejected.error };
          const newSession = makeSession({
            ...sessionData,
            engine: (args?.p_engine_type as string) || sessionData.engine || 'native',
            idempotency_key: args?.p_idempotency_key,
            engine_version: args?.p_engine_version,
            model_name: args?.p_model_name,
            device_type: args?.p_device_type,
          });
          sessionState.sessions.unshift(newSession);
          persistSessions();
          return { data: { new_session: newSession, usage_exceeded: false }, error: null };
        }
        // #1306 Step 3 — the PRODUCTION completion path. This double is what `getSupabaseClient()`
        // returns in E2E (window.supabase), so it — not the Playwright network routes — is what the
        // client actually talks to. It must model the REAL v2 contract: metrics, the single next action
        // and the eligible transcript all committed together, then server-owned newest-two retention,
        // and a typed envelope. A double that returned a bare `{ success: true }` would be the v1
        // envelope, which the client's fail-closed parser correctly rejects.
        if (fn === 'complete_session_v2') {
          const sessionId = args?.p_session_id;
          const session = sessionState.sessions.find((row) => row.id === sessionId);
          const supplied = typeof args?.p_final_transcript === 'string' ? String(args.p_final_transcript).trim() : '';
          const requestedStatus = (args?.p_status as string) || 'completed';

          if (session) {
            Object.assign(session, {
              status: requestedStatus,
              duration: args?.p_final_duration ?? session.duration,
              next_action_signal: args?.p_next_action ?? session.next_action_signal,
              total_words: args?.p_total_words ?? session.total_words,
              clarity_score: args?.p_clarity_score ?? session.clarity_score,
              wpm: args?.p_wpm ?? session.wpm,
              filler_counts: args?.p_filler_counts ?? session.filler_counts,
              pause_metrics: args?.p_pause_metrics ?? session.pause_metrics,
              updated_at: nowIso(),
              // The transcript is written in the SAME call as the metrics — that atomicity is the
              // whole point of v2, and a double that split them would hide a partial-save regression.
              ...(supplied ? { transcript: args?.p_final_transcript, transcript_state: 'available' } : {}),
            });

            // SERVER-OWNED newest-two retention, applied inside the RPC exactly as production does it.
            // Expiring transcripts in test code instead would prove our simulation, not the contract.
            const retained = sessionState.sessions
              .filter((x) => typeof x.transcript === 'string' && String(x.transcript).length > 0)
              .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            retained.slice(2).forEach((old) => {
              old.transcript = null;
              old.transcript_state = 'expired';
            });
            persistSessions();
          }

          const state = (session?.transcript_state as string | undefined)
            ?? (supplied ? 'available' : 'not_captured');
          const outcome = state === 'available' ? 'retained'
            : state === 'expired' ? 'expired'
            : args?.p_final_transcript == null ? 'not_provided'
            : 'not_captured';

          // Marker proving THIS double served the call — asserted by the journey spec so "the mock
          // handled it" is verifiable rather than assumed.
          (win as unknown as { __e2eCompleteSessionV2Calls__?: number }).__e2eCompleteSessionV2Calls__ =
            ((win as unknown as { __e2eCompleteSessionV2Calls__?: number }).__e2eCompleteSessionV2Calls__ ?? 0) + 1;

          return {
            data: {
              success: true,
              session_saved: true,
              idempotent: false,
              final_status: requestedStatus,
              next_action_signal: session?.next_action_signal ?? null,
              transcript_state: state,
              transcript_outcome: outcome,
              transcript_retained: outcome === 'retained',
              retention: { status: 'converged' },
            },
            error: null,
          };
        }
        if (fn === 'complete_session') {
          // #1306 Step 3: the LEGACY overload. The production client cut over to v2 with NO fallback,
          // so any v1 call must fail loudly rather than quietly succeed — otherwise a fallback
          // regression would pass every e2e shard.
          return {
            data: null,
            error: {
              code: 'PGRST202',
              message: 'complete_session (v1) is not callable by the production client — use complete_session_v2',
            },
          };
        }
        if (fn === 'heartbeat_session') {
          return { data: { success: true }, error: null };
        }
        // #1264 — accepting "Practice this next": the RPC returns the new pending attempt id (a string),
        // which the client stores as its repeat handoff before routing back into Open Mic.
        if (fn === 'record_recommendation_attempt') {
          return { data: `attempt-${String(args?.p_recommendation_id ?? 'x')}`, error: null };
        }
        // #1093 server-authoritative streak. The setter is initialize-once; echo the requested zone.
        if (fn === 'set_user_timezone') {
          return { data: (args?.p_timezone as string) ?? 'UTC', error: null };
        }
        // A returning user (fixture has sessions) has an active 3-day streak, which is >=2 so the chip
        // renders; an empty-session fixture reports 'none' (below threshold → chip hidden).
        if (fn === 'get_practice_streak') {
          return {
            data: sessionState.sessions.length
              ? { state: 'active', count: 3, lastQualifyingDate: nowIso().slice(0, 10), timezone: 'UTC' }
              : { state: 'none', count: 0, lastQualifyingDate: null, timezone: 'UTC' },
            error: null,
          };
        }
        if (fn === 'get_analytics_summary') {
          return {
            data: {
              overallStats: {
                totalSessions: sessionState.sessions.length,
                totalPracticeTime: Math.round(sessionState.sessions.reduce((sum, row) => sum + Number(row.duration || 0), 0) / 60),
                averageSessionLength: sessionState.sessions.length
                  ? Math.round(sessionState.sessions.reduce((sum, row) => sum + Number(row.duration || 0), 0) / sessionState.sessions.length)
                  : 0,
                averageWPM: 145,
                avgFillerWordsPerMin: '1.0',
                avgClarity: '92.0',
                avgPausesPerMin: '2.5',
                chartData: [],
              },
              fillerWordTrends: {},
              topFillerWords: [],
              accuracyData: [],
              weeklySessionsCount: sessionState.sessions.length,
              weeklyActivity: [],
            },
            error: null,
          };
        }
        return { data: { success: true }, error: null };
      },
    };

    win.__SS_E2E_ENGINE_CACHE__ = win.__SS_E2E_ENGINE_CACHE__ || {};

    const minimalStubFactory = (mode: string) => (opts?: { 
      onReady?: () => void, 
      onTranscriptUpdate?: (update: {
        transcript: { partial?: string; final?: string };
        isFinal: boolean;
        isPartial: boolean;
        timestamp: number;
      }) => void 
    }) => {
      const cache = win.__SS_E2E_ENGINE_CACHE__ || {};
      win.__SS_E2E_ENGINE_CACHE__ = cache;
      if (cache[mode]) return cache[mode];

      let emittedTranscript = '';
      const instance = {
        instanceId: `mock-${Math.random().toString(36).slice(2)}`,
        checkAvailability: async () => ({ isAvailable: true }),
        init: async (io?: { onReady?: () => void }) => {
          win.__SS_E2E__.isEngineInitialized = true;
          if (io?.onReady) io.onReady();
          return { isOk: true };
        },
        start: async () => {},
        stop: async () => {},
        pause: async () => {},
        resume: async () => {},
        destroy: async () => {},
        terminate: async () => {},
        getEngineType: () => mode,
        getLastHeartbeatTimestamp: () => Date.now(),
        getTranscript: async () => emittedTranscript || win.__SS_E2E__?.lastTranscript || '[E2E_MOCK]',
        transcribe: async () => {
          const value = emittedTranscript || win.__SS_E2E__?.lastTranscript || '[E2E_MOCK]';
          return { isOk: true, value, data: value };
        },
        emitTranscript: (text: string, isFinal: boolean = true) => {
          if (isFinal) {
            emittedTranscript = text;
          }
          if (opts?.onTranscriptUpdate) {
            opts.onTranscriptUpdate({
              transcript: isFinal ? { final: text } : { partial: text },
              isFinal,
              isPartial: !isFinal,
              timestamp: Date.now()
            });
            return;
          }
          win.__SS_E2E__?._activeCallbacks?.onTranscriptUpdate?.({
            transcript: isFinal ? { final: text } : { partial: text },
            isFinal,
            isPartial: !isFinal,
            timestamp: Date.now()
          });
        }
      };
      cache[mode] = instance;
      return instance;
    };

    const realEngineRegistryKeys = Array.isArray((m as SSE2EManifest).realEngineRegistryKeys)
      ? (m as SSE2EManifest).realEngineRegistryKeys ?? []
      : [];
    const supportEngines = ['mock', 'whisper-turbo', 'transformers-js', 'assemblyai', 'native-browser']
      .filter((id) => !realEngineRegistryKeys.includes(id));
    const engineRegistry = Object.fromEntries(
        supportEngines.map(id => [id, minimalStubFactory(id)])
    );

    // #1037 FORBIDDEN-ENGINE GUARD — installed ATOMICALLY here as the registry is built (not via a later
    // interval), so it is authoritative before any application module can call STTRegistry.getEngine. Each
    // forbidden key's factory is replaced with a tripwire that RECORDS construction and THROWS on
    // init/start/transcribe; an installation-proof object records the exact protected key set.
    const forbiddenEngineKeys = Array.isArray((m as SSE2EManifest).forbiddenEngineKeys)
      ? (m as SSE2EManifest).forbiddenEngineKeys ?? []
      : [];
    if (forbiddenEngineKeys.length > 0) {
      win.__SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__ = win.__SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__ || [];
      const recordTripwire = (key: string, phase: string) =>
        win.__SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__!.push({ key, phase, at: Date.now() });
      for (const key of forbiddenEngineKeys) {
        engineRegistry[key] = () => {
          recordTripwire(key, 'construct');
          const boom = (phase: string) => async () => {
            recordTripwire(key, phase);
            throw new Error(`[1037-tripwire] forbidden engine '${key}' ${phase}() invoked during a Browser/Web-Speech journey`);
          };
          return {
            instanceId: `tripwire-${key}`,
            checkAvailability: async () => { recordTripwire(key, 'checkAvailability'); return { isAvailable: false }; },
            init: boom('init'), start: boom('start'), transcribe: boom('transcribe'), getTranscript: boom('getTranscript'),
            stop: async () => {}, pause: async () => {}, resume: async () => {}, destroy: async () => {}, terminate: async () => {},
            getEngineType: () => key, getLastHeartbeatTimestamp: () => Date.now(),
          };
        };
      }
      // Authoritative installation proof (exact protected key set), set atomically with the registry.
      win.__SS_E2E_FORBIDDEN_ENGINE_GUARD__ = { installed: true, protectedKeys: [...forbiddenEngineKeys] };
    }

    const mCast = m as SSE2EManifest;
    win.__SS_E2E__ = {
      isActive: true,
      enableRealEngine: false,
      MOCK_STT_AVAILABILITY: true,
      guestStatus: ut as 'free' | 'pro',
      ... mCast,
      registry: {
        ...engineRegistry,
        ...(mCast.registry || {})
      }
    };

    win.__SS_E2E_BRIDGE__ = {
      emitTranscript: (text: string, isFinal: boolean = true) => {
        const controller = win.__TRANSCRIPTION_SERVICE__;
        if (isFinal && win.__SS_E2E__) {
          win.__SS_E2E__.lastTranscript = text;
        }
        const update = {
          transcript: isFinal ? { final: text } : { partial: text },
          isFinal,
          isPartial: !isFinal,
          timestamp: Date.now()
        };
        if (typeof controller?.handleTranscriptUpdate === 'function') {
          controller.handleTranscriptUpdate(update);
          return;
        }
        const svc = controller?.service;
        const strategyEmit = svc?.strategy?.emitTranscript;
        if (svc && !svc.isTerminated && typeof strategyEmit === 'function') {
          strategyEmit.call(svc.strategy, text, isFinal);
          return;
        }
        win.__SS_E2E__?._activeCallbacks?.onTranscriptUpdate?.(update);
      }
    };

    win.setInterval(() => {
      if (win.__SS_E2E__ && win.__SS_E2E_BRIDGE__) {
        win.__SS_E2E__.emitTranscript = win.__SS_E2E_BRIDGE__.emitTranscript;
      }
    }, 50);

    const t0 = performance.now();
    // Seed only the mock-layer readiness that this init script owns.
    // The app readiness key is `app` and is set by frontend/src/main.tsx after mount.
    win.__APP_READY_STATE__ = { msw: true };
    win.__E2E_READY__ = true;
    win.TEST_MODE = true;
    
    // Stamp the boot duration once the script finishes its T=0 setup
    // 🛡️ Safe-wait for document.documentElement if called too early in addInitScript
    const stampDuration = () => {
      if (document.documentElement) {
        const duration = (performance.now() - t0).toFixed(2);
        document.documentElement.setAttribute('data-boot-duration-ms', duration);
        console.log(`[E2E] Boot telemetry stamped: ${duration}ms`);
      } else {
        setTimeout(stampDuration, 10);
      }
    };
    stampDuration();
  }, { m: manifest, s: storage, ut: userType, mp: mockProfile, es: emptySessions, seed: sessions, progress: progressFixtures });
}
