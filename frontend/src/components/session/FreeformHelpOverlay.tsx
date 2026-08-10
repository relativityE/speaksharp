import * as React from 'react';
import { Play, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRODUCT_NAMES } from '@/constants/productNames';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';

/**
 * #1042 PR2 / #1116 — "How <freeform> works" help overlay.
 *
 * A secondary green island button rendered in the Practice Session title block. Opening it shows a
 * SHORT first-run guide in a dialog (desktop) / bottom sheet (mobile). It NEVER navigates and NEVER
 * starts recording — informational only (plus an optional "start speaking" CTA that just closes it).
 *
 * Availability is driven ENTIRELY by the authoritative Session lifecycle projection passed in as
 * `available`. This component holds NO lifecycle state. When unavailable it is aria-disabled (still
 * focusable) with a persistent accessible explanation, and cannot be opened.
 *
 * Modal redesign (page-designer feedback): the guide previously said everything three times (intro
 * paragraph + six steps + closing paragraph) for what is really THREE ideas. Cut to three numbered
 * items; branded amber numerals (matching the coaching tips); real title hierarchy; a teal primary
 * action so the modal offers a way to start, not just an explanation.
 */

// The product name reads distinctly from the framing words — name BOLD only, "How"/"works" plain normal
// weight, no italics (PO 2026-08-09). Rendered as spans so the ACCESSIBLE NAME stays "How <name> works".
function HelpTitle({ name }: { name: string }) {
    return (
        <>
            <span className="font-normal">How</span>{' '}
            <span className="font-extrabold">{name}</span>{' '}
            <span className="font-normal">works</span>
        </>
    );
}

// Three ideas, not six recorder steps. "Press start / talk / press stop" is the recorder describing
// itself, not instruction — dropped. Each item is a bold ACTION line plus a supporting clause. The
// most valuable idea ("take one thing to improve") is item 3 of 3, not buried at 6 of 6.
const HELP_STEPS: readonly { action: string; detail: string }[] = [
    {
        action: "Pick how you're transcribed",
        detail: 'Browser is instant. Private keeps audio on your device.',
    },
    {
        action: 'Speak as long as you like',
        detail: "No agenda, no script. Stop whenever you're done.",
    },
    {
        action: 'Take one thing to improve',
        detail: "You'll get your transcript, delivery feedback, and a single change to try next time.",
    },
];
// #1046 Focus Points variant — same three-ideas shape, but the ideas are the objective loop: declare the
// points, speak to them, see what landed. Slot D shows the live plan; this modal is the first-run guide.
const OBJECTIVE_STEPS: readonly { action: string; detail: string }[] = [
    {
        action: 'Name the points that must land',
        detail: 'List the few things you need to cover before you start.',
    },
    {
        action: 'Speak to your points',
        detail: 'Talk it through in your own words — no script, just hit each one.',
    },
    {
        action: 'See what you covered',
        detail: 'Each point is marked covered or missed, so you know exactly what to retry.',
    },
];
// a11y description (Radix requires one); the visible content is the title + three items.
const HELP_DESCRIPTION = 'A quick guide to a freeform practice session in three steps.';
const OBJECTIVE_DESCRIPTION = 'A quick guide to a Focus Points practice session in three steps.';
const HELP_DISABLED_REASON =
    'Finish the current recording, save, or recovery step to view this guide.';

export function FreeformHelpOverlay({
    available,
    className = '',
    onStart,
    variant = 'freeform',
}: {
    available: boolean;
    className?: string;
    /** Optional: called after the primary CTA closes the modal, so the page can focus the mic. */
    onStart?: () => void;
    /** #1046 — 'objective' switches the title/steps to "How Focus Points works"; defaults to Open Mic. */
    variant?: 'freeform' | 'objective';
}) {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const disabled = !available;
    const isObjective = variant === 'objective';
    const helpName = isObjective ? PRODUCT_NAMES.objective : PRODUCT_NAMES.freeform;
    const steps = isObjective ? OBJECTIVE_STEPS : HELP_STEPS;
    const description = isObjective ? OBJECTIVE_DESCRIPTION : HELP_DESCRIPTION;

    React.useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    return (
        <div className={className}>
            <Button
                ref={triggerRef}
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled={disabled}
                aria-describedby={disabled ? 'freeform-help-disabled-reason' : undefined}
                data-disabled={disabled ? 'true' : 'false'}
                data-testid="freeform-help-button"
                className={`session-help-shadow inline-flex h-auto max-w-full items-center gap-[8px] whitespace-normal rounded-[10px] bg-[hsl(var(--session-green-deep))] px-[22px] py-[13px] text-center text-[15px] font-bold leading-tight text-[hsl(var(--session-green-deep-foreground))] hover:bg-[hsl(var(--session-green-deep-hover))] hover:text-[hsl(var(--session-green-deep-foreground))] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${disabled ? 'opacity-50' : ''}`}
                onClick={() => { if (!disabled) setOpen(true); }}
            >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                <HelpTitle name={helpName} />
            </Button>
            {disabled && (
                <span id="freeform-help-disabled-reason" className="sr-only">{HELP_DISABLED_REASON}</span>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent
                    // White CARD surface (bg-card) — NOT the page background — so it reads as a panel
                    // floating above the scrim, matching every card on the page (light AND dark theme).
                    // ~520px, rounded-2xl, generous padding. Mobile = bottom sheet. `!duration-0` keeps it
                    // opaque the instant it opens (no fade bleed-through).
                    className="!duration-0 max-h-[85vh] overflow-y-auto rounded-2xl bg-card p-6 sm:max-w-[520px] sm:px-9 sm:py-8 max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0 max-sm:!w-auto max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-b-none max-sm:!rounded-t-2xl"
                    data-testid="freeform-help-overlay"
                    onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus(); }}
                >
                    <DialogTitle className="text-2xl font-extrabold tracking-[-0.025em] text-foreground">
                        <HelpTitle name={helpName} />
                    </DialogTitle>
                    <DialogDescription className="sr-only">{description}</DialogDescription>

                    <ol className="mt-5 space-y-[18px]" data-testid="freeform-help-steps">
                        {steps.map((step, i) => (
                            <li key={step.action} className="flex items-start gap-3">
                                {/* Branded amber numeral — same treatment as the coaching tips. */}
                                <span
                                    aria-hidden="true"
                                    className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#fdf3e2] text-[13px] font-extrabold text-[#b8701a]"
                                >
                                    {i + 1}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-[16px] font-bold leading-snug text-foreground">{step.action}</p>
                                    <p className="mt-0.5 text-[15px] leading-snug text-foreground/70">{step.detail}</p>
                                </div>
                            </li>
                        ))}
                    </ol>

                    {/* Primary action: the modal explains how to start, so give a way to start. */}
                    <Button
                        type="button"
                        data-testid="freeform-help-start"
                        onClick={() => { setOpen(false); onStart?.(); }}
                        className="mt-7 flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#0d7d74] py-[15px] text-[16px] font-bold text-white hover:bg-[#0a5f58]"
                    >
                        Got it — start speaking
                        <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
                    </Button>
                </DialogContent>
            </Dialog>
        </div>
    );
}
