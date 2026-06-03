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
  MOCK_STT_AVAILABILITY?: boolean;
  guestStatus?: 'free' | 'basic' | 'pro';
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
    storage?: Record<string, string>;
    userType?: 'free' | 'basic' | 'pro';
    mockProfile?: Record<string, unknown>;
    emptySessions?: boolean;
  }
) {
  const { storage = {}, userType = 'free', mockProfile, emptySessions = false, ...manifest } = config;
  
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

  await page.addInitScript(({ m, s, ut, mp, es }: { m: unknown; s: Record<string, string>; ut: string; mp?: Record<string, unknown>; es?: boolean }) => {
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
      subscription_status: ut === 'pro' ? 'pro' : ut === 'basic' ? 'basic' : 'free',
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
      subscription_status: ut === 'pro' ? 'pro' : ut === 'basic' ? 'basic' : 'free',
      stripe_subscription_id: ut === 'pro' ? 'sub_e2e_paid_pro' : null,
      subscription_id: ut === 'pro' ? 'sub_e2e_paid_pro' : null,
      usage_seconds: 0,
      usage_reset_date: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
      ...(mp || {}),
    };

    const nowIso = () => new Date().toISOString();
    const makeSession = (overrides: Record<string, unknown> = {}) => ({
      id: `session-${Math.random().toString(36).slice(2)}`,
      user_id: e2eProfile.id,
      title: 'Test Session',
      duration: 300,
      total_words: 150,
      transcript: 'the birch canoe slid on the smooth planks',
      filler_words: { um: { count: 2 }, uh: { count: 3 } },
      accuracy: 0.92,
      clarity_score: 88,
      wpm: 145,
      engine: 'private',
      status: 'completed',
      created_at: nowIso(),
      updated_at: nowIso(),
      ai_suggestions: {
        summary: 'Strong practice session.',
        suggestions: [{ title: 'Keep it clear', description: 'Continue speaking with concise structure.' }],
      },
      pause_metrics: null,
      ...overrides,
    });

    const e2eDbStorageKey = '__SS_E2E_SESSION_DB__';
    const defaultSessions = es ? [] : Array.from({ length: 5 }, (_, index) => makeSession({
        id: `session-${index + 1}`,
        title: `Practice Session ${index + 1}`,
        created_at: new Date(Date.now() - index * 86400000).toISOString(),
      }));
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
      sessions: es ? defaultSessions : (loadPersistedSessions() ?? defaultSessions),
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

    const queryResultFor = (
      table: string,
      single: boolean = false,
      filters: Array<{ column: string; value: unknown }> = [],
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
          filters.every((filter) => String((row as Record<string, unknown>)[filter.column]) === String(filter.value))
        );
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length });
      }
      if (table === 'sessions') {
        let rows = [...sessionState.sessions];
        for (const filter of filters) {
          rows = rows.filter((row) => String((row as Record<string, unknown>)[filter.column]) === String(filter.value));
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
      const filters: Array<{ column: string; value: unknown }> = [];
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
          for (const row of matching) Object.assign(row, pendingMutation.payload || {}, { updated_at: nowIso() });
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
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push({ column, value });
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
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(commitMutation() ?? queryResultFor(table, false, filters, options)).then(resolve, reject),
      };
      return builder;
    };

    win.supabase = {
      auth: {
        getSession: async () => ({ data: { session: authSession }, error: null }),
        getUser: async () => ({ data: { user: authSession?.user ?? null }, error: null }),
        onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
          setTimeout(() => callback('INITIAL_SESSION', authSession), 0);
          return { data: { subscription: { unsubscribe: () => undefined } } };
        },
        signOut: async () => ({ error: null }),
      },
      from: (table: string) => makeQueryBuilder(table),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === 'create_session_and_update_usage') {
          const sessionData = (args?.p_session_data || {}) as Record<string, unknown>;
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
        if (fn === 'complete_session') {
          const sessionId = args?.p_session_id;
          const session = sessionState.sessions.find((row) => row.id === sessionId);
          if (session) {
            Object.assign(session, {
              status: args?.p_status || 'completed',
              transcript: args?.p_final_transcript ?? session.transcript,
              duration: args?.p_final_duration ?? session.duration,
              updated_at: nowIso(),
            });
            persistSessions();
          }
          return { data: { success: true, final_status: args?.p_status || 'completed' }, error: null };
        }
        if (fn === 'heartbeat_session') {
          return { data: { success: true }, error: null };
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
                avgAccuracy: '92.0',
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

    const supportEngines = ['mock', 'whisper-turbo', 'transformers-js', 'assemblyai', 'native-browser'];
    const engineRegistry = Object.fromEntries(
        supportEngines.map(id => [id, minimalStubFactory(id)])
    );

    const mCast = m as SSE2EManifest;
    win.__SS_E2E__ = {
      isActive: true,
      enableRealEngine: false,
      MOCK_STT_AVAILABILITY: true,
      guestStatus: ut as 'free' | 'basic' | 'pro',
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
  }, { m: manifest, s: storage, ut: userType, mp: mockProfile, es: emptySessions });
}
