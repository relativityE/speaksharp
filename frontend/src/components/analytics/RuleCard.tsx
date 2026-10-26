/**
 * #1258 D5 (Rev 2 §5.5) — the Progress rule card: ONE data statement about the newest sessions and one practice
 * action. It replaces the "◎ Do this next" hero (imperative headline, evidence paragraph, WHAT TO TRY list, yellow
 * button); the driver still comes from `getNarrativeSummary`.
 *
 * Window (PO 2026-10-07): the newest 4 sessions, equally weighted, valid measurements only. The eyebrow states the
 * real count ("From your last 4 sessions", or fewer), never a calendar span.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ruleStatement, type RuleSignals } from './ruleStatement';

interface RuleCardProps extends RuleSignals {
    sessionsUsed: number;
}

export const RuleCard: React.FC<RuleCardProps> = ({ sessionsUsed, ...signals }) => {
    if (sessionsUsed < 2) return null;
    const statement = ruleStatement(signals);
    if (!statement) return null;
    const { sentence, metric } = statement;
    return (
        <section className="rounded-[14px] border border-neutral-border-strong bg-white px-5 py-[18px]" data-testid="try-this-next">
            <div className="flex flex-wrap items-center gap-2.5">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-neutral-secondary" data-testid="rule-card-window">
                    From your last {sessionsUsed} sessions
                </p>
                {metric && (
                    <span className="rounded-full border border-signature-border bg-signature-ground px-[9px] py-[3px] text-[12px] font-extrabold text-signature-text" data-testid="rule-card-chip">
                        Focus: {metric}
                    </span>
                )}
            </div>
            <p className="mt-2 text-[17px] font-extrabold leading-snug text-neutral-heading" data-testid="try-this-next-action">{sentence}</p>
            <div className="mt-3.5 flex flex-wrap items-center gap-4">
                {metric && (
                    <Button asChild variant="outline" className="h-10" data-testid="hero-practise-now">
                        <Link to="/session">Practise {metric}</Link>
                    </Button>
                )}
                <details className="text-[14px] font-bold text-neutral-secondary">
                    <summary className="cursor-pointer list-none underline underline-offset-[3px]" data-testid="hero-method">How we worked this out</summary>
                    <p className="mt-2 max-w-md text-[13px] font-normal leading-snug text-neutral-secondary">
                        We compare each delivery signal (pace, fillers, clarity, pause rhythm) against its target across your last {sessionsUsed} sessions and surface the one with the largest, most persistent gap — never more than one at a time.
                    </p>
                </details>
            </div>
        </section>
    );
};
