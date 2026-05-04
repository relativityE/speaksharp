import React, { useEffect, useState, ReactNode } from 'react';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import { buildPolicyForUser } from '@/services/transcription/TranscriptionPolicy';
import { syncProfileReady } from '@/lib/forensicAnchors';
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


    // 2. Handshake Invariant: Confirm readiness whenever entering an active state
    useEffect(() => {
        if (runtimeState === 'INITIATING' || runtimeState === 'ENGINE_INITIALIZING') {
            logger.debug({ state: runtimeState }, '[TranscriptionProvider] Re-confirming handshake for active transition');
            speechRuntimeController.confirmSubscriberHandshake();
        }
    }, [runtimeState]);

    useEffect(() => {
        // 1. Immediate Handshake (UI is mounted and ready for data)
        speechRuntimeController.confirmSubscriberHandshake();

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
        
        // 🛡️ Forensic Barrier: Signal profile hydration and policy sync are complete
        syncProfileReady(true);

        return () => {
            syncProfileReady(false);
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
