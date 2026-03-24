import React, { useEffect, useState } from 'react';
import { speechRuntimeController } from '../services/SpeechRuntimeController';
import { TranscriptionPolicy, buildPolicyForUser } from '../services/transcription/TranscriptionPolicy';
import logger from '../lib/logger';
import ProfileContext from '../contexts/ProfileContext';
import { TranscriptionContext } from './TranscriptionContext';
import { useSessionStore } from '../stores/useSessionStore';

export const TranscriptionProvider: React.FC<{
    children: React.ReactNode;
    policy?: TranscriptionPolicy; // Optional policy
}> = ({ children }) => {
    const profileContext = React.useContext(ProfileContext);
    const profile = profileContext?.profile;

    // 1. Authoritative Store Access (Pure Projection)
    const runtimeState = useSessionStore(state => state.runtimeState);
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

    return (
        <TranscriptionContext.Provider value={{ isReady: ready, runtimeState }}>
            {children}
        </TranscriptionContext.Provider>
    );
};
