import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, FileDown, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TRIAL_ENDED_COPY, type TrialEndedKeep } from './trialStatus';

const KEEP_ICONS = { history: BarChart3, export: FileDown, account: UserRound } as const satisfies Record<TrialEndedKeep, unknown>;

/**
 * Replaces the recorder in the before state when the trial has ended. It says what happened, what still works,
 * and where to go next. It never starts checkout itself: it points to Pricing, which shows checkout only when
 * payments are enabled. `paymentsEnabled` changes one sentence so the page never promises an upgrade that
 * Pricing cannot offer.
 */
export const TrialEndedPanel: React.FC<{ paymentsEnabled: boolean }> = ({ paymentsEnabled }) => (
    <section
        data-testid="trial-ended-panel"
        aria-labelledby="trial-ended-title"
        className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 text-card-foreground surface-shadow sm:p-8"
    >
        <h2 id="trial-ended-title" className="text-2xl font-extrabold tracking-tight text-foreground">
            {TRIAL_ENDED_COPY.title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{TRIAL_ENDED_COPY.body}</p>

        <ul className="mt-5 space-y-2.5" data-testid="trial-ended-keeps">
            {TRIAL_ENDED_COPY.keeps.map(({ key, label }) => {
                const Icon = KEEP_ICONS[key];
                return (
                    <li key={key} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{label}</span>
                    </li>
                );
            })}
        </ul>

        <p className="mt-5 text-sm font-semibold text-foreground" data-testid="trial-ended-continuation">
            {paymentsEnabled ? TRIAL_ENDED_COPY.continueOpen : TRIAL_ENDED_COPY.continueClosed}
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button asChild variant={paymentsEnabled ? 'default' : 'outline'}>
                <Link to="/pricing" data-testid="trial-ended-pricing">{TRIAL_ENDED_COPY.pricingCta}</Link>
            </Button>
            <Button asChild variant="outline">
                <Link to="/progress" data-testid="trial-ended-progress">Open Progress</Link>
            </Button>
            <Button asChild variant="ghost">
                <Link to="/account" data-testid="trial-ended-account">Account</Link>
            </Button>
        </div>
    </section>
);
