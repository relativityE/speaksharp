/**
 * Transcription Policy Module
 * 
 * Defines the policy interface and pre-built policies for controlling
 * which transcription modes are allowed in different contexts.
 * 
 * This is part of the Policy-Driven Strategy Pattern, which separates
 * environment/tier policy from execution strategy.
 */

import logger from '@/lib/logger';
import { emitEngineRequestCollapsedToPrivate, isRetiredEngineRequest } from './sttExclusivityTelemetry';

export type TranscriptionMode = 'native' | 'cloud' | 'private' | 'mock';

/**
 * Policy object that defines which transcription modes are permitted
 * and which mode should be preferred.
 */
export interface TranscriptionPolicy {
    /** Whether Native Browser (Web Speech API) is allowed */
    allowNative: boolean;
    /** Whether Cloud (AssemblyAI) is allowed */
    allowCloud: boolean;
    /** Whether Private (On-Device Whisper) is allowed */
    allowPrivate: boolean;
    /** The preferred mode to use (if allowed). Null means use first allowed. */
    preferredMode: TranscriptionMode | null;
    /** Whether to fall back to another mode on failure */
    allowFallback: boolean;
    /** Optional label for logging/debugging */
    executionIntent?: string;
}

// ============================================================================
// PRODUCTION POLICIES
// ============================================================================

/**
 * Legacy unpaid-state production policy. Private is the only customer engine. Access timing is decided
 * by the server entitlement seam before recording starts, not by engine policy or accumulated minutes.
 */
export const PROD_FREE_POLICY: TranscriptionPolicy = {
    allowNative: false,
    allowCloud: false,
    allowPrivate: true,
    preferredMode: 'private',
    allowFallback: false,
    executionIntent: 'prod-free',
};

/**
 * Paid-state production policy. It is intentionally engine-identical to the active trial: Private only.
 */
export const PROD_PRO_POLICY: TranscriptionPolicy = {
    allowNative: false,
    allowCloud: false,
    allowPrivate: true,
    preferredMode: 'private',
    allowFallback: false,
    executionIntent: 'prod-pro',
};

// ============================================================================
// E2E TEST POLICIES
// ============================================================================

/**
 * E2E policy for deterministic Native mode testing.
 * Forces Native Browser, no fallback.
 */
export const E2E_DETERMINISTIC_NATIVE: TranscriptionPolicy = {
    allowNative: true,
    allowCloud: false,
    allowPrivate: false,
    preferredMode: 'native',
    allowFallback: false,
    executionIntent: 'e2e-deterministic-native',
};

/**
 * E2E policy for deterministic Cloud mode testing.
 * Forces Cloud (AssemblyAI), no fallback.
 */
export const E2E_DETERMINISTIC_CLOUD: TranscriptionPolicy = {
    allowNative: false,
    allowCloud: true,
    allowPrivate: false,
    preferredMode: 'cloud',
    allowFallback: false,
    executionIntent: 'e2e-deterministic-cloud',
};

/**
 * E2E policy for deterministic Private mode testing.
 * Forces Private (Whisper), no fallback.
 */
export const E2E_DETERMINISTIC_PRIVATE: TranscriptionPolicy = {
    allowNative: false,
    allowCloud: false,
    allowPrivate: true,
    preferredMode: 'private',
    allowFallback: false,
    executionIntent: 'e2e-deterministic-private',
};

// ============================================================================
// POLICY RESOLUTION HELPERS
// ============================================================================

/**
 * Resolve the mode to use based on policy and optional user preference.
 * 
 * @param policy - The TranscriptionPolicy to apply
 * @param userPreference - Optional mode selected by user in UI
 * @returns The resolved TranscriptionMode
 * @throws Error if no modes are allowed by the policy
 */
export function resolveMode(
    policy: TranscriptionPolicy,
    userPreference?: TranscriptionMode | null
): TranscriptionMode {
    logger.info({
        policyId: policy.executionIntent,
        userPref: userPreference,
        policyPref: policy.preferredMode,
        allowNative: policy.allowNative,
        allowCloud: policy.allowCloud,
        allowPrivate: policy.allowPrivate
    }, '[TranscriptionPolicy] Resolving mode:');

    // 0. Safety Check: If absolutely no modes are allowed, throw standardized error
    if (!policy.allowNative && !policy.allowCloud && !policy.allowPrivate) {
        throw new Error('No allowed transcription mode');
    }

    // #1184 traceability: a retired-engine (native/cloud) request the policy disallows WILL collapse to
    // Private below. Emit a PERSISTED event so any such request is queryable (this should never happen in
    // healthy Private-only operation; a non-zero rate flags a bug or a stale caller).
    if (isRetiredEngineRequest(userPreference) && !isModeAllowed(userPreference as TranscriptionMode, policy)) {
        emitEngineRequestCollapsedToPrivate({ source: 'resolveMode', requestedMode: userPreference as string });
    }

    // 1. Check user preference (if allowed)
    if (userPreference && isModeAllowed(userPreference, policy)) {
        logger.info({ resolved: userPreference, source: 'user-preference' }, '[TranscriptionPolicy] Resolved mode');
        return userPreference;
    }

    // 2. Resort to Policy Preference or first allowed mode
    if (policy.preferredMode && isModeAllowed(policy.preferredMode, policy)) {
        return policy.preferredMode;
    }
    if (policy.allowNative) return 'native';
    if (policy.allowCloud) return 'cloud';
    if (policy.allowPrivate) return 'private';

    throw new Error(`[TranscriptionPolicy] Requested mode '${userPreference || policy.preferredMode}' is not allowed by current policy.`);
}

/**
 * Check if a specific mode is allowed by the policy.
 */
export function isModeAllowed(
    mode: TranscriptionMode,
    policy: TranscriptionPolicy
): boolean {
    switch (mode) {
        case 'native': return policy.allowNative;
        case 'cloud': return policy.allowCloud;
        case 'private': return policy.allowPrivate;
        case 'mock': return true; // Always allow mock
        default: return false;
    }
}

/**
 * Build a Private-only policy from the caller's already-resolved entitlement state plus an optional
 * internal test request. The server remains authoritative for whether a recording may start.
 *
 * @param hasPrivateSttAccess - Already-resolved access state; it affects observability labels only.
 * @param uiMode - Optional mode selected by user in UI
 * @returns A TranscriptionPolicy configured for the user
 */
export function buildPolicyForUser(
    hasPrivateSttAccess: boolean,
    uiMode?: TranscriptionMode | null,
    options?: { allowCloud?: boolean }
): TranscriptionPolicy {
    // #1184 STT exclusivity: Private is the ONLY engine. The tier flag and `allowCloud` are retained for
    // call-site compatibility but can NO LONGER widen the engine set — a Free user, a Pro user, and any
    // requested `allowCloud:true` all resolve to the same Private-only policy. `uiMode` cannot re-enable
    // native/cloud either (`allowNative/allowCloud` stay false, so `resolveMode` can only return 'private').
    // `options.allowCloud` can no longer widen the engine set — Cloud is never user-facing.
    void options;
    // #1184 traceability: a native/cloud UI request is neutralized to Private here — record it as a
    // persisted event so the collapse is queryable (fail-closed).
    if (isRetiredEngineRequest(uiMode)) {
        emitEngineRequestCollapsedToPrivate({ source: 'buildPolicyForUser', requestedMode: uiMode as string });
    }
    // The tier flag now selects only the executionIntent LABEL (prod-free vs prod-pro) for observability;
    // both bases are Private-only, so engine capability is identical either way.
    const base = hasPrivateSttAccess ? PROD_PRO_POLICY : PROD_FREE_POLICY;
    const hasExplicitMode = uiMode !== undefined && uiMode !== null;

    return {
        ...base,
        allowNative: false,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'private',
        // Disable fallback if the caller passed an explicit mode (Privacy Guard); Private's only
        // permitted internal fallback is another Private variant (v2 <-> v4), handled downstream.
        allowFallback: hasExplicitMode ? false : base.allowFallback,
        executionIntent: `${base.executionIntent}-private`,
    };
}
