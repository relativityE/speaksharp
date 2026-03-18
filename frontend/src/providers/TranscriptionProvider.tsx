import React, { useEffect, useState } from 'react';
import { speechRuntimeController, RuntimeState } from '../services/SpeechRuntimeController';
import { TranscriptionPolicy, buildPolicyForUser } from '../services/transcription/TranscriptionPolicy';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { createContext } from 'react';
import logger from '../lib/logger';
import ProfileContext from '../contexts/ProfileContext';
import { TranscriptionContext } from './TranscriptionContext';

export const TranscriptionProvider: React.FC<{
    children: React.ReactNode;
    policy?: TranscriptionPolicy; // Optional policy
}> = ({ children }) => {
    const profileContext = React.useContext(ProfileContext);
    const profile = profileContext?.profile;

    // 1. Controller-Bound Instance (Managed by SpeechRuntimeController)
    // The service is now transient and provided by the controller.
    const [service, setService] = useState<TranscriptionService | null>(() => speechRuntimeController.getService());
    const [runtimeState, setRuntimeState] = useState<RuntimeState>(() => speechRuntimeController.getState());
    const [ready, setReady] = useState(false);

    // Sync service instance and readiness whenever the runtime state changes
    useEffect(() => {
        const handleStateChange = () => {
             setService(speechRuntimeController.getService());
             setRuntimeState(speechRuntimeController.getState());
        };
        window.addEventListener('speech-runtime-state', handleStateChange as EventListener);
        
        // Ensure engine is warming up on mount (Clean Pipeline Entry)
        speechRuntimeController.warmUp().then(() => {
            setReady(true);
        }).catch(err => {
            logger.error({ err }, '[TranscriptionProvider] Warm-up failed');
        });

        return () => window.removeEventListener('speech-runtime-state', handleStateChange as EventListener);
    }, []);

    // 2. Policy Re-Synchronization & E2E Gating
    // Whenever the profile changes (e.g., upgraded to Pro), re-sync the service policy.
    useEffect(() => {
        if (!profile?.id || !service) return; // Wait for stable auth and active service

        const tier = profile.subscription_status || 'free';
        
        logger.info({ 
            subscriptionStatus: tier,
            intent: 'Syncing policy and setting E2E gate' 
        }, '[TranscriptionProvider] Syncing policy');
        
        const newPolicy = buildPolicyForUser(tier === 'pro');
        service.updatePolicy(newPolicy);

        // Behavioral Gating - Setting E2E wait attribute
        if (typeof document !== 'undefined') {
            document.body.setAttribute('data-user-tier', tier);
        }

        return () => {
            // Cleanup
            if (typeof document !== 'undefined') {
                document.body.removeAttribute('data-user-tier');
            }
        };
    }, [profile?.id, profile?.subscription_status, service]);

    // 3. Lifecycle Audit: Handled by SpeechRuntimeController
    useEffect(() => {
        logger.info('[TranscriptionProvider] Component mounted');
    }, []);

    return (
        <TranscriptionContext.Provider value={{ service, isReady: ready, runtimeState }}>
            {children}
        </TranscriptionContext.Provider>
    );
};

