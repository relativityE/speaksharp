import React, { useEffect, useState } from 'react';
import { getTranscriptionService } from '../services/transcription/TranscriptionService';
import { TranscriptionPolicy, buildPolicyForUser } from '../services/transcription/TranscriptionPolicy'; // Import the type
import logger from '../lib/logger';
import ProfileContext from '../contexts/ProfileContext';
import { TranscriptionContext } from './TranscriptionContext';

export const TranscriptionProvider: React.FC<{
    children: React.ReactNode;
    policy?: TranscriptionPolicy; // Optional policy
}> = ({ children, policy: initialPolicy }) => {
    const profileContext = React.useContext(ProfileContext);
    const profile = profileContext?.profile;

    // 1. Singleton Acquisition (Survives Remounts)
    // We initialize with a default policy, but we'll sync it in the effect below.
    const [service] = useState(() => getTranscriptionService(initialPolicy ? { policy: initialPolicy } : {}));
    const [isReady] = useState(true);

    // 2. Policy Re-Synchronization & E2E Gating
    // Whenever the profile changes (e.g., upgraded to Pro), re-sync the service policy.
    useEffect(() => {
        if (!profile?.id) return; // Wait for stable auth to avoid flickering

        const tier = profile.subscription_status || 'free';
        
        logger.info({ 
            subscriptionStatus: tier,
            intent: 'Syncing policy and setting E2E gate' 
        }, '[TranscriptionProvider] Syncing policy');
        
        const newPolicy = buildPolicyForUser(tier === 'pro');
        service.updatePolicy(newPolicy);

        // Behavioral Gating - Setting E2E wait attribute
        // Moved to DOMSync inside App.tsx or managed cleanly here via React effects
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

    // 3. Lifecycle Audit: Singleton Persistence
    useEffect(() => {
        logger.info('[TranscriptionProvider] Component mounted');
        return () => {
             logger.info('[TranscriptionProvider] Component unmounting - Cleaning up service');
             service.destroy().catch(err => {
                 logger.warn({ err }, '[TranscriptionProvider] Silent failure during service cleanup');
             });
        };
    }, [service]);

    return (
        <TranscriptionContext.Provider value={{ service, isReady }}>
            {children}
        </TranscriptionContext.Provider>
    );
};

