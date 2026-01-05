/**
 * Transcription Policy Module
 *
 * Defines the policy interface and pre-built policies for controlling
 * which transcription modes are allowed in different contexts.
 *
 * This is part of the Policy-Driven Strategy Pattern, which separates
 * environment/tier policy from execution strategy.
 */

export type TranscriptionMode = 'native' | 'cloud' | 'private';

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
 * Free tier production policy.
 * Only Native Browser is available.
 */
export const PROD_FREE_POLICY: TranscriptionPolicy = {
    allowNative: true,
    allowCloud: false,
    allowPrivate: false,
    preferredMode: 'native',
    allowFallback: false,
    executionIntent: 'prod-free',
};

/**
 * Pro tier production policy.
 * All modes available, user preference or UI selection determines mode.
 */
export const PROD_PRO_POLICY: TranscriptionPolicy = {
    allowNative: true,
    allowCloud: true,
    allowPrivate: true,
    preferredMode: null, // Will be set by UI selection
    allowFallback: true,
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
    // 1. Check user preference (if allowed)
    if (userPreference && isModeAllowed(userPreference, policy)) {
        return userPreference;
    }

    // 2. Check policy's preferred mode
    if (policy.preferredMode && isModeAllowed(policy.preferredMode, policy)) {
        return policy.preferredMode;
    }

    // 3. Fallback order: native -> cloud -> private
    if (policy.allowNative) return 'native';
    if (policy.allowCloud) return 'cloud';
    if (policy.allowPrivate) return 'private';

    throw new Error('[TranscriptionPolicy] No allowed transcription mode in policy');
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
        default: return false;
    }
}

/**
 * Build a policy for the given user tier with an optional UI mode selection.
 *
 * @param isProUser - Whether the user has Pro subscription
 * @param uiMode - Optional mode selected by user in UI
 * @returns A TranscriptionPolicy configured for the user
 */
export function buildPolicyForUser(
    isProUser: boolean,
    uiMode?: TranscriptionMode | null
): TranscriptionPolicy {
    const base = isProUser ? PROD_PRO_POLICY : PROD_FREE_POLICY;
    return {
        ...base,
        preferredMode: uiMode ?? base.preferredMode,
        executionIntent: `${base.executionIntent}-${uiMode ?? 'default'}`,
    };
}
