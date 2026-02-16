/**
 * 100% Type-Safe E2E Configuration
 * Industry Pattern: Single Configuration Object
 */

export interface E2EConfig {
    context: 'e2e' | 'unit' | 'integration' | 'production';
    testMode: boolean;

    stt: {
        mode: 'real' | 'mock';
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
        overrides: Map<string, any>;
    };

    exposedState: {
        sessionStore?: any;
        activeSpeechRecognition?: any;
    };
}

export const DEFAULT_E2E_CONFIG: E2EConfig = {
    context: 'production',
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
    return (window as any).__E2E_CONFIG__ || DEFAULT_E2E_CONFIG;
}

export function initE2EConfig(config: Partial<E2EConfig>): void {
    if (typeof window === 'undefined') return;
    (window as any).__E2E_CONFIG__ = {
        ...DEFAULT_E2E_CONFIG,
        ...config,
        stt: { ...DEFAULT_E2E_CONFIG.stt, ...config.stt },
        progress: { ...DEFAULT_E2E_CONFIG.progress, ...config.progress },
        auth: { ...DEFAULT_E2E_CONFIG.auth, ...config.auth },
        limits: { ...DEFAULT_E2E_CONFIG.limits, ...config.limits },
        registry: { ...DEFAULT_E2E_CONFIG.registry, ...config.registry },
        exposedState: { ...DEFAULT_E2E_CONFIG.exposedState, ...config.exposedState }
    };
}

declare global {
    interface Window {
        __E2E_CONFIG__?: E2EConfig;
    }
}
