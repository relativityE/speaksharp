/**
 * #1258 D5/D11 (Rev 2 §5.2) — the Progress overview's ink header. It owns the page `h1` ("Your progress", test id
 * `dashboard-heading` kept), one factual line about the person's practice and the focus control.
 *
 * The greeting is UNNAMED (PM Rev 2 notes): the first-name column/RPC is a separate, undecided scope, so no name is
 * shown and none is ever inferred from the email. "since {date}" appears only when the oldest session's date is known;
 * without it the line is withheld rather than reworded.
 */
import React from 'react';
import { PRODUCT_LABEL, shortDate } from '@/lib/displayFormat';
import type { SessionProduct } from '@/types/session';

interface ProgressHeaderProps {
    sessionCount: number;
    /** The oldest counted session's `created_at`, or null while unknown. */
    firstSessionAt: string | null;
    /** The newest session; `product` is the persisted one (null for a legacy row). */
    latest: { product: SessionProduct | null; createdAt: string } | null;
    focusLabel: string;
    focusControl: React.ReactNode;
}

export const ProgressHeader: React.FC<ProgressHeaderProps> = ({ sessionCount, firstSessionAt, latest, focusLabel, focusControl }) => {
    const line = sessionCount <= 0 ? null
        : sessionCount === 1 ? 'Your first session is in.'
            : firstSessionAt && shortDate(firstSessionAt) ? `You've done ${sessionCount} sessions since ${shortDate(firstSessionAt)}.`
                : null;
    const latestWhat = latest ? [latest.product ? PRODUCT_LABEL[latest.product] : null, shortDate(latest.createdAt)].filter(Boolean).join(', ') : '';
    return (
        <section className="flex flex-wrap items-start gap-4 rounded-2xl bg-ink px-7 py-[26px]" data-testid="progress-header">
            <div className="min-w-0 flex-[1_1_320px]">
                <h1 data-testid="dashboard-heading" className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">Your progress</h1>
                {line && (
                    <p className="mt-2.5 text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-white" data-testid="progress-header-line">{line}</p>
                )}
                {latestWhat && (
                    <p className="mt-2 text-[15px] font-semibold text-ink-muted" data-testid="progress-header-latest">
                        Latest: {latestWhat} · Working on {focusLabel}
                    </p>
                )}
            </div>
            {focusControl}
        </section>
    );
};
