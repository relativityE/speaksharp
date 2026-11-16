import React from 'react';
import { Clock } from 'lucide-react';
import type { TrialCountdown, TrialCountdownTone } from './trialStatus';

/**
 * A small, quiet line of trial time on the practice page. It grows louder only as the end gets close:
 * neutral for most of the trial, the signature colour from three days out, and the error colour in the last
 * 24 hours. All three come from the shared `--brand-*` roles, so it reads like the page's other chips.
 */
const TONE_CLASSES: Record<TrialCountdownTone, string> = {
    calm: 'border-neutral-border bg-neutral-band text-neutral-secondary font-semibold',
    soon: 'border-signature-border bg-signature-ground text-signature-text font-bold',
    urgent: 'border-state-error-border bg-state-error-ground text-state-error font-bold',
};

export const TrialCountdownChip: React.FC<{ countdown: TrialCountdown; className?: string }> = ({ countdown, className }) => (
    <span
        data-testid="trial-countdown"
        data-trial-tone={countdown.tone}
        // Polite, not assertive: the value only changes when the server is asked again, and it is never an error.
        role="status"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${TONE_CLASSES[countdown.tone]} ${className ?? ''}`.trim()}
    >
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {countdown.label}
    </span>
);
