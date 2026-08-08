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
    cue: string;
}

let nextPointId = 1;
const makePoint = (): PointDraft => ({ id: nextPointId++, label: '', cue: '' });

export function ObjectiveSetupForm({
    onReady,
    className = '',
}: {
    /** Called with the persisted ids once the brief is saved — the caller routes into the session. */
    onReady?: (result: { briefId: string; projectId: string }) => void;
    className?: string;
}) {
    const [goal, setGoal] = React.useState('');
    const [points, setPoints] = React.useState<PointDraft[]>(() => [makePoint(), makePoint(), makePoint()]);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const labelledPoints = points.filter((p) => p.label.trim() !== '');
    const canSubmit = goal.trim() !== '' && labelledPoints.length >= 1 && !submitting;

    const updatePoint = (id: number, field: 'label' | 'cue', value: string) => {
        setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
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
                points: labelledPoints.map((p) => ({ label: p.label, cue: p.cue })),
            });
        } catch {
            result = { ok: false, reason: 'error' };
        }
        if (result.ok && result.briefId && result.projectId) {
            onReady?.({ briefId: result.briefId, projectId: result.projectId });
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
            <p className="mt-1 text-[15px] leading-snug text-foreground/70">
                Name what you’re rehearsing, then list the points you want to cover. After you record,
                each one is marked covered or missed.
            </p>

            <div className="mt-6">
                <Label htmlFor="objective-goal" className="text-[13px] font-bold text-foreground">
                    What are you rehearsing?
                </Label>
                <Input
                    id="objective-goal"
                    data-testid="objective-goal-input"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="e.g. 2-minute sales pitch"
                    className="mt-1.5"
                    maxLength={140}
                />
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
                                    onChange={(e) => updatePoint(p.id, 'label', e.target.value)}
                                    placeholder={i === 0 ? 'e.g. Name the price' : 'Another point to cover'}
                                    maxLength={120}
                                />
                                <Input
                                    data-testid={`objective-point-cue-${i}`}
                                    aria-label={`Reminder for focus point ${i + 1} (optional)`}
                                    value={p.cue}
                                    onChange={(e) => updatePoint(p.id, 'cue', e.target.value)}
                                    placeholder="Optional reminder"
                                    maxLength={140}
                                    className="mt-1.5 h-8 text-[13px] text-foreground/80"
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
                    : <>Start speaking <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" /></>}
            </Button>
        </form>
    );
}

export default ObjectiveSetupForm;
