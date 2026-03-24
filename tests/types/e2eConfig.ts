/**
 * 100% Type-Safe E2E Configuration
 * Industry Pattern: Single Configuration Object
 */

export interface E2EConfig {
    mode: 'e2e' | 'unit' | 'integration' | 'production';
    testMode: boolean;

    stt: {
        mode: 'real' | 'mock';
        loadTimeout?: number;
        mocks: {
            native?: 'auto' | 'manual' | false;
            private?: 'auto' | 'manual' | false;
            cloud?: 'auto' | 'manual' | false;
        };
        forceOptions?: {
            useCPU?: boolean;
            disableWebGPU?: boolean;
        };
    };

    progress: {
        mode: 'auto' | 'manual';
        advance?: (progress: number) => void;
    };

    auth: {
        mode: 'real' | 'mock';
        mockUser?: {
            id: string;
            email: string;
            subscription_status: 'free' | 'pro';
        };
        mockSession?: {
            id: string;
            userId: string;
        };
    };

    limits: {
        mode: 'real' | 'mock';
        mockLimit?: {
            remaining_seconds: number;
            error?: string;
        };
    };

    registry: {
        overrides: Map<string, unknown>;
    };

    exposedState: {
        sessionStore?: unknown;
        activeSpeechRecognition?: unknown;
    };
    
    // Feature Flags / Context (Consolidated from loose globals)
    isE2E?: boolean;
    useMockSession?: boolean;
    emptySessions?: boolean;
    mswReady?: boolean;
    debug?: boolean;
}

export const DEFAULT_E2E_CONFIG: E2EConfig = {
    mode: 'production',
    testMode: false,
    stt: { mode: 'real', mocks: {} },
    progress: { mode: 'auto' },
    auth: { mode: 'real' },
    limits: { mode: 'real' },
    registry: { overrides: new Map() },
    exposedState: {}
};

export function getE2EConfig(): E2EConfig {
    if (typeof window === 'undefined') return DEFAULT_E2E_CONFIG;
    
    // Bridge: Derive E2EConfig from the modern __SS_E2E__ manifest
    if (window.__SS_E2E__) {
        const manifest = window.__SS_E2E__;
        return {
            ...DEFAULT_E2E_CONFIG,
            mode: manifest.isActive ? 'e2e' : 'production',
            isE2E: manifest.isActive,
            stt: {
                mode: manifest.engineType === 'mock' ? 'mock' : 'real',
                mocks: {}
            },
            registry: {
                overrides: new Map(Object.entries(manifest.registry || {}))
            },
            debug: manifest.debug
        };
    }
    
    return DEFAULT_E2E_CONFIG;
}

export function initE2EConfig(config: Partial<E2EConfig>): void {
    if (typeof window === 'undefined') return;
    
    // 🚀 Strict Zero Alignment: Initialize the modern manifest directly
    window.__SS_E2E__ = {
        isActive: !!(config.mode === 'e2e' || config.isE2E),
        engineType: config.stt?.mode === 'mock' ? 'mock' : 'real',
        registry: config.registry?.overrides ? Object.fromEntries(config.registry.overrides.entries()) : {},
        debug: config.debug,
        flags: {
            bypassMutex: config.mode === 'e2e', // Optional: preserve some logic if helpful
            fastTimers: config.mode === 'e2e'
        }
    };

    // Note: Legacy pointers (__APP_TEST_ENV__, TEST_MODE) are DELETED per mandate.
}

declare global {
    interface Window {
        __E2E_EMPTY_SESSIONS__?: boolean;
    }
}
