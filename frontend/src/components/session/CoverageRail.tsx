/**
 * #1254 — DETECTION LANGUAGE, NOT COVERAGE LANGUAGE.
 *
 * The engine behind these words is a conservative LOCAL KEYWORD MATCHER. "Covered" asserts the point was
 * addressed; "missed" asserts the speaker failed to address it. Neither is what was measured — the engine
 * can only report whether it DETECTED the point's language. A speaker who made the point in their own
 * words and got an amber "missed" pip was told they failed at something they did.
 *
 * So the surface says detected / not detected, which is exactly what the measurement supports.
 */
import * as React from 'react';
import type { CoverageStatus } from '@/services/rehearsal/outcomeScorecard';

/**
 * #1046 slice 4 — Focus Points coverage rail.
 *
 * Rail-slot content for a Focus Points session (the sibling of Open Mic's coaching card — same shell,
 * different content). One row per declared focus point; each row's dot + tint reflects whether the point
 * was covered. v1 computes coverage AT STOP (the whole rail resolves when the session finalizes); live
 * ticking is a fast-follow.
 *
 * Accessibility: colour is NOT the only signal. Each row carries a status word (an sr-only label +
 * `data-status`) and the dot changes fill, so red/yellow/green is legible to colour-blind users too.
 * Colours follow the four-role palette — progress green / mic-amber / regression red, never decoration.
 */

/** A point to render: its id, the label to show, and its resolved coverage status. */
export interface CoverageRailPoint {
    id: string;
    label: string;
    status: CoverageStatus;
}

const STATUS_STYLE: Record<CoverageStatus, { dot: string; text: string; word: string }> = {
    // covered → progress green; partial → mic-amber; missing → regression red. Text tints subtly so the
    // row itself reads its state, but the dot + word carry the meaning (never colour alone).
    covered: { dot: 'bg-[#146b4a]', text: 'text-foreground', word: 'Detected' },
    partial: { dot: 'bg-[#d98a1f]', text: 'text-foreground', word: 'Partly detected' },
    missing: { dot: 'bg-[#a8321f]/70', text: 'text-foreground/70', word: 'Not detected' },
};

export function CoverageRail({
    points,
    className = '',
}: {
    points: CoverageRailPoint[];
    className?: string;
}) {
    const covered = points.filter((p) => p.status === 'covered').length;

    return (
        <section
            data-testid="coverage-rail"
            aria-label="Focus Points coverage"
            className={`rounded-2xl border border-[hsl(var(--border-strong))] bg-card p-5 ${className}`}
        >
            <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-[#6d28d9]">Focus Points</h3>
                {points.length > 0 && (
                    <span data-testid="coverage-rail-summary" className="text-[13px] font-bold text-foreground/70">
                        {covered}/{points.length} detected
                    </span>
                )}
            </div>

            <ol className="mt-3 space-y-2.5" data-testid="coverage-rail-list">
                {points.map((p, i) => {
                    const s = STATUS_STYLE[p.status];
                    return (
                        <li
                            key={p.id}
                            data-testid={`coverage-point-${i}`}
                            data-status={p.status}
                            className="flex items-start gap-2.5"
                        >
                            <span aria-hidden="true" className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
                            <span className={`text-[15px] leading-snug ${s.text}`}>{p.label}</span>
                            {/* Non-colour cue for screen readers + colour-blind users. */}
                            <span className="sr-only">{s.word}</span>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

export default CoverageRail;
