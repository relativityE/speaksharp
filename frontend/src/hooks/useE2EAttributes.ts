import { useEffect } from 'react';
import { useSessionStore } from '@/stores/useSessionStore';
import { useReadinessStore, REQUIRED_GLOBAL } from '../stores/useReadinessStore';
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
    const { activeEngine, sttMode, modelLoadingProgress } = useSessionStore();
    
    const readinessSignals = useReadinessStore(s => s.signals);
    const appState = useReadinessStore(s => s.appState);

    // 1. App Boot & Route Readiness
    useEffect(() => {
        const missing = REQUIRED_GLOBAL.filter(k => !readinessSignals[k]);
        const allSignalsReady = missing.length === 0;
        
        if (!allSignalsReady && Object.keys(readinessSignals).length > 0) {
            logger.debug({ missing, signals: readinessSignals }, '[useE2EAttributes] Waiting for signals...');
        }

        if (allSignalsReady) {
            // NOTE: data-app-ready is the canonical terminal signal for E2E.
            if (document.documentElement.getAttribute('data-app-ready') !== 'true') {
                logger.info('[useE2EAttributes] 🏁 APP READY BARRIER CLEARED. Signaling E2E.');
                document.documentElement.setAttribute('data-app-ready', 'true');
            }
        }

        if (readinessSignals.router) {
            document.documentElement.setAttribute('data-router-mounted', 'true');
        } else {
            document.documentElement.removeAttribute('data-router-mounted');
        }

        document.documentElement.setAttribute('data-ready-state', appState);

    }, [readinessSignals, appState]);

    // Metadata: Policy & Progress
    // Note: data-recording-state, data-engine-ready, and data-session-persisted 
    // are now managed EXCLUSIVELY by SpeechRuntimeController (Source of Truth).
    
    useEffect(() => {
        const effectiveMode = (activeEngine && activeEngine !== 'none') ? activeEngine : sttMode;
        
        if (effectiveMode) {
            document.body.setAttribute('data-stt-policy', effectiveMode);
        } else {
            document.body.removeAttribute('data-stt-policy');
        }
    }, [activeEngine, sttMode]);

    useEffect(() => {
        if (modelLoadingProgress !== null) {
            document.body.setAttribute('data-download-progress', String(modelLoadingProgress));
        } else {
            document.body.removeAttribute('data-download-progress');
        }
    }, [modelLoadingProgress]);
};
