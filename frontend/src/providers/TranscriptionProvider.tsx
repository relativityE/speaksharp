import React, { useEffect, useRef, useState, ReactNode } from 'react';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import { buildPolicyForUser } from '@/services/transcription/TranscriptionPolicy';
import { getEffectiveSubscriptionStatus, hasCloudSttEntitlement } from '@/constants/subscriptionTiers';
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
    const lastPolicyKeyRef = useRef<string | null>(null);
    const policyProfile = React.useMemo(() => {
        if (!profile?.id) return null;
        return {
            id: profile.id,
            subscription_status: profile.subscription_status,
            trial_expires_at: profile.trial_expires_at,
            stripe_subscription_id: profile.stripe_subscription_id,
        };
    }, [
        profile?.id,
        profile?.subscription_status,
        profile?.trial_expires_at,
        profile?.stripe_subscription_id,
    ]);


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

        // 2. Mark the provider ready without selecting an engine. Engine warm-up
        // is modeful and mutates controller policy, so Session lifecycle owns it
        // after profile/tier resolution to avoid native/private init churn.
        speechRuntimeController.initializeInfrastructure().then(() => {
            setReady(true);
            logger.info('[TranscriptionProvider] ✅ Provider handshake ready');
        }).catch(err => {
            logger.error({ err }, '[TranscriptionProvider] Infrastructure initialization failed');
        });
    }, []);

    // 2. Policy Re-Synchronization & E2E Gating
    // Whenever the profile changes (e.g., upgraded to Pro), re-sync the service policy through the controller.
    useEffect(() => {
        if (!policyProfile?.id) return; // Wait for stable auth

        const tier = getEffectiveSubscriptionStatus(null, policyProfile);

        const currentSelectedMode = useSessionStore.getState().sttMode;

        logger.info({
            subscriptionStatus: tier,
            selectedMode: currentSelectedMode,
            intent: 'Syncing policy and setting E2E gate'
        }, '[TranscriptionProvider] Syncing policy');

        const isPro = tier === 'pro';
        const canUseCloud = isPro && hasCloudSttEntitlement(policyProfile);
        const requestedMode = isPro ? currentSelectedMode : null;
        const safeMode = requestedMode === 'cloud' && !canUseCloud ? 'private' : requestedMode;
        // NOTE (P2, tracked in BACKLOG): this writer intentionally remains TIER-ONLY for now —
        // it passes `isPro`, not the sample-aware `isPro || hasPrivateSampleEntitlement` capability.
        // The sample entitlement lives in `usageLimit` (the check_usage_limit RPC), which this
        // provider deliberately does not consume; modeful/sample policy is owned by the Session
        // lifecycle. This stays safe because (a) `startRecording` overwrites the controller policy
        // with the lifecycle's sample-aware policy at record time, and (b) this resync only re-fires
        // on profile-tier fields, never on mode/record/sample state. Full sample-aware unification of
        // all policy writers is deferred (do NOT "fix" by changing this to raw isPro elsewhere).
        const newPolicy = buildPolicyForUser(isPro, safeMode, { allowCloud: canUseCloud });
        const policyKey = JSON.stringify(newPolicy);
        if (lastPolicyKeyRef.current !== policyKey) {
            lastPolicyKeyRef.current = policyKey;
            speechRuntimeController.updatePolicy(newPolicy);
        }
        
        // 🛡️ Forensic Barrier: Signal profile hydration and policy sync are complete
        syncProfileReady(true);

        return () => {
            syncProfileReady(false);
        };
    }, [
        policyProfile,
    ]);

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
