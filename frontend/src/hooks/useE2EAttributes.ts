import { useEffect } from 'react';
import { useSessionStore } from '../stores/useSessionStore';
import { useReadinessStore } from '../stores/useReadinessStore';
import logger from '../lib/logger';

/**
 * useE2EAttributes - Authoritative DOM signaling for E2E tests.
 * 
 * Maps global FSM and store state to canonical DOM attributes:
 * - data-app-booted: "true | false" (Infrastructure readiness)
 * - data-route-ready: "true | false" (Page content painted)
 * - data-recording-state: "idle | recording | failed | terminated"
 * - data-engine-ready: "true | false"
 * - data-session-persisted: "true | false"
 * - data-stt-policy: "native | cloud | private | null"
 * - data-download-progress: "0-100 | null"
 */
export const useE2EAttributes = () => {
    const activeEngine = useSessionStore(s => s.activeEngine);
    const modelLoadingProgress = useSessionStore(s => s.modelLoadingProgress);
    
    const readinessSignals = useReadinessStore(s => s.signals);
    const appState = useReadinessStore(s => s.appState);

    // 1. App Boot & Route Readiness
    useEffect(() => {
        const allSignalsReady = readinessSignals.boot && readinessSignals.layout && 
                               readinessSignals.auth && readinessSignals.stt && 
                               readinessSignals.msw;
        
        if (allSignalsReady) {
            // NOTE: data-app-booted remains in the hook for now as it aggregates 
            // multiple infrastructure signals (Auth, layout, msw) beyond just STT.
            if (document.documentElement.getAttribute('data-app-booted') !== 'true') {
                logger.info('[useE2EAttributes] 🏁 BOOT BARRIER CLEARED. Signaling E2E.');
                document.documentElement.setAttribute('data-app-booted', 'true');
            }
        }

        if (readinessSignals.route) {
            document.documentElement.setAttribute('data-route-ready', 'true');
        } else {
            document.documentElement.removeAttribute('data-route-ready');
        }

        document.documentElement.setAttribute('data-ready-state', appState);

    }, [readinessSignals, appState]);

    // Metadata: Policy & Progress
    // Note: data-recording-state, data-engine-ready, and data-session-persisted 
    // are now managed EXCLUSIVELY by SpeechRuntimeController (Source of Truth).
    
    useEffect(() => {
        if (activeEngine && activeEngine !== 'none') {
            document.body.setAttribute('data-stt-policy', activeEngine);
        } else {
            document.body.removeAttribute('data-stt-policy');
        }
    }, [activeEngine]);

    useEffect(() => {
        if (modelLoadingProgress !== null) {
            document.body.setAttribute('data-download-progress', String(modelLoadingProgress));
        } else {
            document.body.removeAttribute('data-download-progress');
        }
    }, [modelLoadingProgress]);
};
