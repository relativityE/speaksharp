import React, { useEffect, useState, ReactNode } from 'react';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import { buildPolicyForUser } from '@/services/transcription/TranscriptionPolicy';
import logger from '@/lib/logger';
import ProfileContext from '@/contexts/ProfileContext';
import { TranscriptionContext, type TranscriptionContextValue } from './TranscriptionContext';
import { useSessionStore } from '@/stores/useSessionStore';

interface TranscriptionProviderProps {
  children: ReactNode;
  store?: typeof useSessionStore; // Optional injection for test parity
}

export const TranscriptionProvider: React.FC<TranscriptionProviderProps> = ({ 
  children, 
  store: injectedStore 
}) => {
    const profileContext = React.useContext(ProfileContext);
    const profile = profileContext?.profile;

    const useStore = injectedStore || useSessionStore;
    const runtimeState = useStore((state) => state.runtimeState);
    const [ready, setReady] = useState(false);

    // Sync state whenever the runtime state changes
    useEffect(() => {
        // Handshake Invariant: Confirm readiness whenever entering an active state
        if (runtimeState === 'INITIATING' || runtimeState === 'ENGINE_INITIALIZING') {
            logger.debug({ state: runtimeState }, '[TranscriptionProvider] Re-confirming handshake for active transition');
            speechRuntimeController.confirmSubscriberHandshake();
        }
    }, [runtimeState]);

    useEffect(() => {
        // 1. Immediate Handshake (UI is mounted and ready for data)
        speechRuntimeController.confirmSubscriberHandshake();

        // 🛡️ E2E LIVENESS PULSE: Ensure boot barrier is satisfied even if init hangs
        if (typeof window !== 'undefined' && (window as unknown as { __SS_E2E__?: { isActive: boolean } }).__SS_E2E__?.isActive) {
            const failsafe = setTimeout(() => {
                if (document.documentElement.getAttribute('data-app-ready') !== 'true') {
                    console.warn('[E2E-FAILSAFE] Forcefully emitting data-app-ready signal');
                    document.documentElement.setAttribute('data-app-ready', 'true');
                }
            }, 500);
            return () => clearTimeout(failsafe);
        }

        // 2. Ensure engine is warming up on mount (Clean Pipeline Entry)
        speechRuntimeController.warmUp().then(() => {
            setReady(true);
            logger.info('[TranscriptionProvider] ✅ Provider warm-up signal received');
        }).catch(err => {
            logger.error({ err }, '[TranscriptionProvider] Warm-up failed');
        });
    }, []);

    // 2. Policy Re-Synchronization & E2E Gating
    // Whenever the profile changes (e.g., upgraded to Pro), re-sync the service policy through the controller.
    useEffect(() => {
        if (!profile?.id) return; // Wait for stable auth

        const tier = profile.subscription_status || 'free';

        logger.info({
            subscriptionStatus: tier,
            intent: 'Syncing policy and setting E2E gate'
        }, '[TranscriptionProvider] Syncing policy');

        const newPolicy = buildPolicyForUser(tier === 'pro');
        speechRuntimeController.updatePolicy(newPolicy);

        // Behavioral Gating - Setting E2E wait attribute
        // TARGET: document.documentElement for authoritative contract surface
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-user-tier', tier);
        }

        return () => {
            // Cleanup
            if (typeof document !== 'undefined') {
                document.documentElement.removeAttribute('data-user-tier');
            }
        };
    }, [profile?.id, profile?.subscription_status]);

    const contextValue: TranscriptionContextValue = {
        isReady: ready,
        runtimeState,
        useStore,
    };

    return (
        <TranscriptionContext.Provider value={contextValue}>
            {children}
        </TranscriptionContext.Provider>
    );
};
