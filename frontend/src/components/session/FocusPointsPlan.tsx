import * as React from 'react';

/**
 * #1046 — Focus Points **plan** (the slot-D content BEFORE and DURING a Focus Points session).
 *
 * It lists the points the user declared, as a neutral "to cover" checklist — deliberately NOT the
 * {@link CoverageRail}, whose red "missing" tint would read as failure before anything has been scored.
 * Coverage is computed AT STOP, so the resolved rail replaces this only in the after-state. Same card
 * chrome as the coverage rail so slot D is visually continuous across the three states.
 */

/** A declared point to show in the plan: a stable id + the label. */
export interface FocusPointsPlanPoint {
    id: string;
    label: string;
}

export function FocusPointsPlan({
    points,
    className = '',
}: {
    points: FocusPointsPlanPoint[];
    className?: string;
}) {
    return (
        <section
            data-testid="focus-points-plan"
            aria-label="Focus Points to cover"
            className={`rounded-2xl border border-[hsl(var(--border-strong))] bg-card p-5 ${className}`}
        >
            <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-[#6d28d9]">Focus Points</h3>
                {points.length > 0 && (
                    <span data-testid="focus-points-plan-summary" className="text-[13px] font-bold text-foreground/70">
                        {points.length} to cover
                    </span>
                )}
            </div>

            <ol className="mt-3 space-y-2.5" data-testid="focus-points-plan-list">
                {points.map((p, i) => (
                    <li
                        key={p.id}
                        data-testid={`focus-plan-point-${i}`}
                        className="flex items-start gap-2.5"
                    >
                        {/* Neutral numeral marker — a plan, not a verdict; no red/green until coverage resolves. */}
                        <span
                            aria-hidden="true"
                            className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-[#c8b8f0] text-[10px] font-extrabold text-[#6d28d9]"
                        >
                            {i + 1}
                        </span>
                        <span className="text-[15px] leading-snug text-foreground">{p.label}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
}

export default FocusPointsPlan;
