import { getE2EConfig, initE2EConfig } from './e2eConfig';

export function migrateOldFlags(): void {
    if (typeof window === 'undefined') return;
    const win = window as any;
    if (win.__E2E_CONFIG__) return;

    initE2EConfig({
        context: win.__E2E_CONTEXT__ ? 'e2e' : 'production',
        testMode: win.TEST_MODE || false,
        stt: {
            mode: win.REAL_WHISPER_TEST ? 'real' : 'mock',
            mocks: {
                native: win.__E2E_MOCK_NATIVE__ ? 'auto' : false,
                private: win.__E2E_MOCK_LOCAL_WHISPER__ ? 'auto' : false
            },
            forceOptions: { useCPU: win.__FORCE_TRANSFORMERS_JS__ || false }
        },
        progress: {
            mode: win.__E2E_MANUAL_PROGRESS__ ? 'manual' : 'auto',
            advance: win.__E2E_ADVANCE_PROGRESS__
        },
        auth: {
            mode: (win.__E2E_MOCK_SESSION__ || win.__E2E_MOCK_PROFILE__) ? 'mock' : 'real',
            mockUser: win.__E2E_MOCK_USER_PROFILE__,
            mockSession: win.__E2E_MOCK_SESSION__
        },
        limits: {
            mode: win.__E2E_MOCK_USAGE_LIMIT__ ? 'mock' : 'real',
            mockLimit: win.__E2E_MOCK_USAGE_LIMIT__
        },
        registry: { overrides: win.__TEST_REGISTRY__ || new Map() },
        exposedState: {
            sessionStore: win.useSessionStore,
            activeSpeechRecognition: win.__activeSpeechRecognition
        }
    });
}

export function exposeBackwardCompatFlags(): void {
    if (typeof window === 'undefined') return;
    const config = getE2EConfig();
    const win = window as any;
    win.__E2E_CONTEXT__ = config.context === 'e2e';
    win.TEST_MODE = config.testMode;
    win.__E2E_MOCK_NATIVE__ = config.stt.mocks.native !== false;
    win.__E2E_MOCK_LOCAL_WHISPER__ = config.stt.mocks.private !== false;
    win.REAL_WHISPER_TEST = config.stt.mode === 'real';
    win.__FORCE_TRANSFORMERS_JS__ = config.stt.forceOptions?.useCPU;
    win.__E2E_MANUAL_PROGRESS__ = config.progress.mode === 'manual';
    win.__E2E_ADVANCE_PROGRESS__ = config.progress.advance;
    win.__E2E_MOCK_SESSION__ = config.auth.mockSession;
    win.__E2E_MOCK_PROFILE__ = config.auth.mockUser;
    win.__E2E_MOCK_USAGE_LIMIT__ = config.limits.mockLimit;
    win.useSessionStore = config.exposedState.sessionStore;
    win.__activeSpeechRecognition = config.exposedState.activeSpeechRecognition;
}
