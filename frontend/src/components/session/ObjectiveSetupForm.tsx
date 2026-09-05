import * as React from 'react';
import { Plus, X, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PRODUCT_NAMES } from '@/constants/productNames';
import {
    startObjectiveBrief,
    OBJECTIVE_MAX_POINTS,
    type ObjectiveBriefResult,
    type ObjectiveBriefFailureReason,
} from '@/services/objective/objectiveBriefService';

/**
 * #1046 G2 slice 2 — Focus Points capture form.
 *
 * Before a Focus Points session the user declares (a) what they're rehearsing and (b) the handful of
 * points they want to cover. On submit we persist a versioned brief via the guarded RPCs and hand the
 * brief id back to the caller, which routes into the objective session flow.
 *
 * v1 scope (PO 2026-08-07) = **points + goal**. Target length is defaulted server-side and audience is
 * left blank — both are supported by the RPC and can be surfaced later without a schema change.
 *
 * This component only CAPTURES. It never asserts capability itself — the RPC is the authority and a
 * `capability`/`auth` failure is shown as honest copy. The activation flip (#1046 slice 5) decides when
 * this form is reachable; until then it is not wired to the live practice card.
 */

// Honest, PII-free copy for each failure reason the service can return.
const FAILURE_COPY: Record<ObjectiveBriefFailureReason, string> = {
    validation: 'Add a goal and at least one focus point.',
    auth: 'Please sign in to start a Focus Points session.',
    capability: `${PRODUCT_NAMES.objective} isn’t available on your account yet.`,
    error: 'Could not save your focus points. Please try again.',
};

interface PointDraft {
    id: number;
    label: string;
}

let nextPointId = 1;
const makePoint = (): PointDraft => ({ id: nextPointId++, label: '' });

// #1046: the "What are you rehearsing?" quick-pick topics. Four common contexts + "Other" (free text).
const TOPIC_OPTIONS = [
    'Job interview',
    'Sales or product pitch',
    'Conference talk / keynote',
    'Team update / standup',
] as const;

/**
 * #1407 — seed values for EDITING an existing brief. Absent means a blank form, which is what "Start a
 * new set" requires: no topic, points or pace may survive from the take just reviewed.
 */
export interface ObjectiveSetupInitial {
    topic?: string | null;
    points?: string[] | null;
    paceGuideSecPerPoint?: number | null;
}

export function ObjectiveSetupForm({
    onReady,
    initial,
    className = '',
}: {
    /** Called with the persisted ids + the declared point labels once the brief is saved — the caller binds
     *  them to the store and routes into the session (the labels drive the before/during Focus Points list). */
    onReady?: (result: { briefId: string; projectId: string; points: string[]; topic: string; paceGuideSecPerPoint: number | null }) => void;
    /** #1407 Edit: prefill from the brief being edited. Omit for a blank form (Start a new set). */
    initial?: ObjectiveSetupInitial;
    className?: string;
}) {
    // Seeded ONCE per mount. The dialog unmounts its content when closed, so each open re-seeds from the
    // `initial` passed for THAT open — which is how Edit shows the current brief and New Set shows nothing.
    const [goal, setGoal] = React.useState(() => initial?.topic ?? '');
    // Dropdown selection: '' (unchosen), a TOPIC_OPTIONS value, or 'other' (reveals the free-text field).
    // An edited brief's topic is free text we cannot assume matches a quick-pick, so 'other' is chosen
    // whenever a topic exists but is not one of the options — the value is preserved either way.
    const [topic, setTopic] = React.useState(() => {
        const seeded = initial?.topic ?? '';
        if (!seeded) return '';
        return (TOPIC_OPTIONS as readonly string[]).includes(seeded) ? seeded : 'other';
    });
    const [points, setPoints] = React.useState<PointDraft[]>(() => {
        const seeded = (initial?.points ?? []).filter((p) => p.trim() !== '');
        if (seeded.length === 0) return [makePoint(), makePoint(), makePoint()];
        return seeded.map((label) => ({ id: nextPointId++, label }));
    });
    // #1046 G6/G7 §0/§2: the pace GUIDE — minutes per point, default 1, half-min steps 0.5–3. null = skipped
    // (everything pace-related then vanishes and pace nudges never fire). It NEVER blocks Start speaking.
    const [paceGuideMin, setPaceGuideMin] = React.useState<number | null>(() => {
        if (initial === undefined) return 1;
        // An edited brief that SKIPPED pace must stay skipped; only an absent seed falls back to the default.
        return initial.paceGuideSecPerPoint == null ? null : Math.round((initial.paceGuideSecPerPoint / 60) * 2) / 2;
    });
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const labelledPoints = points.filter((p) => p.label.trim() !== '');
    const canSubmit = goal.trim() !== '' && labelledPoints.length >= 1 && !submitting;
    // Derived total is never typed — the unit the user can estimate is per-point, and it stays correct as
    // the set grows. Recomputed live from the labelled-point count.
    const paceTotalMin = paceGuideMin != null ? Math.round(labelledPoints.length * paceGuideMin * 10) / 10 : null;
    const fmtMin = (m: number) => (Number.isInteger(m) ? `${m}` : `${m}`);
    const adjustPace = (delta: number) => setPaceGuideMin((prev) => {
        const next = Math.round(((prev ?? 1) + delta) * 2) / 2; // snap to 0.5
        return Math.max(0.5, Math.min(3, next));
    });

    const onTopicChange = (value: string) => {
        setTopic(value);
        // A preset IS the goal; 'Other'/unchosen clears it so the free-text field drives the goal.
        setGoal(value === 'other' || value === '' ? '' : value);
    };
    const updatePoint = (id: number, value: string) => {
        setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, label: value } : p)));
    };
    const addPoint = () => {
        setPoints((prev) => (prev.length >= OBJECTIVE_MAX_POINTS ? prev : [...prev, makePoint()]));
    };
    const removePoint = (id: number) => {
        // Never drop to zero rows — keep at least one input so the form always has somewhere to type.
        setPoints((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.id !== id)));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        let result: ObjectiveBriefResult;
        try {
            result = await startObjectiveBrief({
                goal,
                points: labelledPoints.map((p) => ({ label: p.label })),
            });
        } catch {
            result = { ok: false, reason: 'error' };
        }
        if (result.ok && result.briefId && result.projectId) {
            onReady?.({
                briefId: result.briefId,
                projectId: result.projectId,
                points: labelledPoints.map((p) => p.label.trim()),
                // #1046 G6/G7: the topic is a first-class field (the `goal`), shown above the points in slot D
                // and NEVER an element of points[] / never scored as one.
                topic: goal.trim(),
                // §0/§2: the pace guide as seconds/point (null when skipped → no pace UI, no pace nudge).
                paceGuideSecPerPoint: paceGuideMin != null ? Math.round(paceGuideMin * 60) : null,
            });
            return; // leave the button in its submitting state while the caller navigates away
        }
        setError(FAILURE_COPY[result.reason ?? 'error']);
        setSubmitting(false);
    };

    return (
        <form
            onSubmit={(e) => { void handleSubmit(e); }}
            data-testid="objective-setup-form"
            className={`rounded-2xl border border-[hsl(var(--border-strong))] bg-card p-6 sm:p-8 ${className}`}
        >
            <h2 className="text-2xl font-extrabold tracking-[-0.025em] text-foreground">
                Set your {PRODUCT_NAMES.objective}
            </h2>

            <div className="mt-5">
                <Label htmlFor="objective-goal" className="text-[13px] font-bold text-foreground">
                    What are you rehearsing?
                </Label>
                <select
                    id="objective-goal"
                    data-testid="objective-goal-select"
                    value={topic}
                    onChange={(e) => onTopicChange(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="">Choose a topic…</option>
                    {TOPIC_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="other">Other…</option>
                </select>
                {topic === 'other' && (
                    <Input
                        data-testid="objective-goal-input"
                        aria-label="What are you rehearsing?"
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        placeholder="e.g. 2-minute wedding toast"
                        className="mt-1.5"
                        maxLength={140}
                        autoFocus
                    />
                )}
            </div>

            <div className="mt-6">
                <span className="text-[13px] font-bold text-foreground">Focus points</span>
                <ol className="mt-1.5 space-y-2.5" data-testid="objective-points-list">
                    {points.map((p, i) => (
                        <li key={p.id} className="flex items-start gap-2">
                            <span
                                aria-hidden="true"
                                className="mt-2.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#fdf3e2] text-[12px] font-extrabold text-[#b8701a]"
                            >
                                {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <Input
                                    data-testid={`objective-point-label-${i}`}
                                    aria-label={`Focus point ${i + 1}`}
                                    value={p.label}
                                    onChange={(e) => updatePoint(p.id, e.target.value)}
                                    placeholder={i === 0 ? 'e.g. Name the price' : 'Another point to cover'}
                                    maxLength={120}
                                />
                            </div>
                            <button
                                type="button"
                                data-testid={`objective-point-remove-${i}`}
                                aria-label={`Remove focus point ${i + 1}`}
                                onClick={() => removePoint(p.id)}
                                disabled={points.length <= 1}
                                className="mt-1.5 rounded-md p-2 text-foreground/50 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ol>
                {points.length < OBJECTIVE_MAX_POINTS && (
                    <button
                        type="button"
                        data-testid="objective-add-point"
                        onClick={addPoint}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-bold text-[#7b5ce0] transition-colors hover:bg-[#7b5ce0]/10"
                    >
                        <Plus className="h-4 w-4" />
                        Add a point
                    </button>
                )}
            </div>

            {/* §0/§2 Pace guide — minutes per point, derived total live, skippable, never blocks Start. */}
            <div data-testid="objective-pace-guide" className="mt-6 rounded-xl border border-[#eef1f6] bg-[#f7f9fc] p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-[14px] font-extrabold text-[#2b3446]">Pace guide</div>
                        <div className="mt-0.5 text-[12px] font-semibold text-[#8b95a5]">A guide, not a limit.</div>
                    </div>
                    {paceGuideMin != null ? (
                        <div className="flex items-center gap-2">
                            <div className="flex items-center overflow-hidden rounded-[9px] border border-[#dbe2ec] bg-white">
                                <button type="button" data-testid="objective-pace-dec" aria-label="Less time per point"
                                    onClick={() => adjustPace(-0.5)} disabled={paceGuideMin <= 0.5}
                                    className="px-[11px] py-2 text-[15px] font-bold text-[#8b95a5] hover:bg-muted disabled:opacity-30">−</button>
                                <span data-testid="objective-pace-value" className="min-w-[46px] px-1.5 py-2 text-center text-[15px] font-extrabold tabular-nums text-[#2b3446]">{fmtMin(paceGuideMin)} min</span>
                                <button type="button" data-testid="objective-pace-inc" aria-label="More time per point"
                                    onClick={() => adjustPace(0.5)} disabled={paceGuideMin >= 3}
                                    className="px-[11px] py-2 text-[15px] font-bold text-[#8b95a5] hover:bg-muted disabled:opacity-30">+</button>
                            </div>
                            <span className="whitespace-nowrap text-[13px] font-bold text-[#414b5c]">/point</span>
                        </div>
                    ) : (
                        <button type="button" data-testid="objective-pace-restore" onClick={() => setPaceGuideMin(1)}
                            className="text-[13px] font-bold text-[#6d28d9] hover:underline">Add a guide</button>
                    )}
                </div>
                <div className="mt-[13px] flex items-center justify-between gap-3 border-t border-[#e6ebf2] pt-3">
                    {paceGuideMin != null ? (
                        <span data-testid="objective-pace-total" className="text-[13px] font-bold text-[#414b5c]">
                            {labelledPoints.length} point{labelledPoints.length === 1 ? '' : 's'} × {fmtMin(paceGuideMin)} min ≈ <strong className="font-extrabold text-[#2b3446]">{fmtMin(paceTotalMin ?? 0)} min</strong>
                        </span>
                    ) : (
                        <span className="text-[13px] font-semibold text-[#8b95a5]">No pace guide — you’ll see coverage only.</span>
                    )}
                    {paceGuideMin != null && (
                        <button type="button" data-testid="objective-pace-skip" onClick={() => setPaceGuideMin(null)}
                            className="whitespace-nowrap text-[13px] font-bold text-[#8b95a5] hover:underline">Skip the guide</button>
                    )}
                </div>
            </div>

            {error && (
                <p data-testid="objective-setup-error" role="alert" className="mt-4 text-[13px] font-medium text-destructive">
                    {error}
                </p>
            )}

            <Button
                type="submit"
                data-testid="objective-setup-submit"
                disabled={!canSubmit}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#7b5ce0] py-[15px] text-[16px] font-bold text-white hover:bg-[#6a4fd0]"
            >
                {submitting
                    ? <><Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" /> Saving…</>
                    : <>Proceed to session <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" /></>}
            </Button>
        </form>
    );
}

export default ObjectiveSetupForm;
