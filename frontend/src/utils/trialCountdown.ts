import type { UsageLimitCheck } from '@/hooks/useUsageLimit';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

export const TRIAL_WARNING_THRESHOLD_SECONDS = 10 * 60;
export const PRACTICE_LIMIT_WARNING_THRESHOLD_SECONDS = 5 * 60;

type TrialLimit = Pick<UsageLimitCheck, 'trial_active' | 'trial_expires_at' | 'trial_seconds_remaining'>;

export const getTrialSecondsRemaining = (
    usageLimit: TrialLimit | null | undefined,
    options: { nowMs?: number; elapsedSecondsFallback?: number } = {}
): number | null => {
    if (usageLimit?.trial_active !== true) return null;

    if (usageLimit.trial_expires_at) {
        const expiresAtMs = Date.parse(usageLimit.trial_expires_at);
        if (Number.isFinite(expiresAtMs)) {
            return Math.max(0, Math.ceil((expiresAtMs - (options.nowMs ?? Date.now())) / 1000));
        }
    }

    if (typeof usageLimit.trial_seconds_remaining === 'number') {
        const elapsed = Math.max(0, options.elapsedSecondsFallback ?? 0);
        return Math.max(0, Math.floor(usageLimit.trial_seconds_remaining - elapsed));
    }

    return null;
};

export const isTrialPrivateSession = (
    usageLimit: Pick<UsageLimitCheck, 'trial_active'> | null | undefined,
    mode: TranscriptionMode,
    canUseCloudStt: boolean
): boolean => usageLimit?.trial_active === true && mode === 'private' && !canUseCloudStt;
