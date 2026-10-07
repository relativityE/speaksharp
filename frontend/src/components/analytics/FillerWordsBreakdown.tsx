/** #1258 D6 — Filler words on Progress (Rev 2 §5.8). The model lives in `fillerBreakdown.ts`. */
import React from 'react';
import { plural, shortDate } from '@/lib/displayFormat';
import type { FillerBreakdownModel } from './fillerBreakdown';

const Cell: React.FC<{ n: number }> = ({ n }) => (
    <td className="py-2.5 text-right tabular-nums">
        {n > 0 ? (
            <>
                <strong className="text-[15px] font-extrabold text-neutral-heading">{n}</strong>
                <span className="text-[13px] font-semibold text-neutral-secondary"> {n === 1 ? 'time' : 'times'}</span>
            </>
        ) : (
            <span className="text-neutral-muted">—</span>
        )}
    </td>
);

export const FillerWordsBreakdown: React.FC<{ model: FillerBreakdownModel }> = ({ model }) => {
    const { latest, previous, rows } = model;
    if (!latest) {
        return <p className="text-[14px] font-semibold text-neutral-secondary">Appears after {plural(1, 'more session', 'more sessions')}</p>;
    }
    if (previous && latest.count === 0 && previous.count === 0) {
        return <p className="text-[15px] font-bold text-neutral-heading" data-testid="filler-breakdown-none">No filler words detected in your last two sessions.</p>;
    }
    return (
        <div data-testid="filler-words-breakdown">
            <p className="text-[22px] font-extrabold text-neutral-heading">{latest.count} in your latest session</p>
            {previous && (
                <p className="mt-0.5 text-[14px] font-semibold text-neutral-muted">
                    {previous.count} in the one before ({shortDate(previous.createdAt)})
                </p>
            )}
            {rows.length > 0 && (
                <>
                    <div className="mt-3.5 flex flex-wrap items-baseline gap-1.5 rounded-[10px] border border-signature-border bg-signature-ground px-3.5 py-2.5">
                        <span className="text-[14px] font-extrabold text-neutral-heading">Times each word was said</span>
                        <span className="text-[13px] font-bold text-signature-text">· counted, not per minute</span>
                    </div>
                    <table className="mt-2 w-full border-collapse text-[14px] text-neutral-body">
                        <thead>
                            <tr>
                                <th scope="col" className="py-2 text-left text-[13px] font-extrabold text-neutral-heading">Word</th>
                                <th scope="col" className="py-2 text-right text-[13px] font-extrabold text-neutral-heading">{shortDate(latest.createdAt)} (latest)</th>
                                {previous && <th scope="col" className="py-2 text-right text-[13px] font-extrabold text-neutral-heading">{shortDate(previous.createdAt)}</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.key} className="border-t border-neutral-border-soft" data-testid={`filler-breakdown-row-${r.key}`}>
                                    <th scope="row" className="py-2.5 text-left font-bold">{r.label}</th>
                                    <Cell n={r.latest} />
                                    {previous && <Cell n={r.previous} />}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
};
