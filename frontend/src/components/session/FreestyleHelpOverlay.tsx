import * as React from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRODUCT_NAMES } from '@/constants/productNames';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';

/**
 * #1042 PR2 — "How Freestyle Practice works" help overlay.
 *
 * A secondary, outlined button rendered directly above the Mic-ready status surface on the Practice
 * Session page. Opening it shows the approved Freestyle guide in a partial dialog (desktop) / bottom
 * sheet (mobile). It NEVER navigates and NEVER starts recording — it is purely informational.
 *
 * Availability is driven ENTIRELY by the authoritative Session lifecycle projection passed in as
 * `available` (computed in SessionPage from the runtime FSM + finalizing + unresolved-recovery signals).
 * This component holds NO lifecycle state and defines NO second lock model. When unavailable it is
 * aria-disabled (still focusable) with a persistent accessible explanation, and cannot be opened.
 */

const HELP_TITLE = `How ${PRODUCT_NAMES.freeform} works`;
const HELP_INTRO =
    "No agenda required. Choose a transcription method, start when you're ready, and speak freely.";
const HELP_STEPS: readonly string[] = [
    'Choose your transcription method.',
    'Start when you are ready.',
    'Speak freely.',
    'Stop and wait while the recording is saved.',
    'Review your transcript and available delivery feedback.',
    'Choose one improvement for the next attempt.',
];
const HELP_FEEDBACK =
    'After you stop, SpeakSharp saves your transcript and shows the delivery feedback available for that session.';
const HELP_DISABLED_REASON =
    'Finish the current recording, save, or recovery step to view this guide.';

export function FreestyleHelpOverlay({ available, className = '' }: { available: boolean; className?: string }) {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const disabled = !available;

    // Never auto-open, and never remain open once the session becomes busy: if availability drops while
    // the guide is open (e.g. the user starts recording another way), close it. Radix restores focus.
    React.useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    return (
        <div className={className}>
            <Button
                ref={triggerRef}
                type="button"
                // #1047: an ISLAND, not a ghost button. Previously this was a white outlined button 12px
                // above the white status bar, which made the page open with two same-width white rounded
                // rectangles stacked on top of each other — so the guide read as a SECOND STATUS ROW
                // rather than as something you can do. Filling it with the brand dark green (token, never
                // an inline hex) and giving it a leading play glyph makes it unmistakably an action and
                // visually disjoint from the ambient status surface beneath it.
                variant="ghost"
                size="sm"
                // aria-disabled (NOT native `disabled`) keeps the control focusable so the persistent
                // explanation below is reachable by assistive tech; activation is blocked in onClick.
                aria-disabled={disabled}
                aria-describedby={disabled ? 'freestyle-help-disabled-reason' : undefined}
                data-disabled={disabled ? 'true' : 'false'}
                data-testid="freestyle-help-button"
                // `whitespace-normal` + `max-w-full` override the shared Button's `whitespace-nowrap`:
                // at a 320px viewport the label is wider than the content box, and a nowrap island would
                // push the page into horizontal scroll.
                className={`session-help-shadow inline-flex h-auto max-w-full items-center gap-[8px] whitespace-normal rounded-[10px] bg-[hsl(var(--session-green-deep))] px-[22px] py-[13px] text-center text-[15px] font-bold leading-tight text-[hsl(var(--session-green-deep-foreground))] hover:bg-[hsl(var(--session-green-deep-hover))] hover:text-[hsl(var(--session-green-deep-foreground))] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${disabled ? 'opacity-50' : ''}`}
                onClick={() => { if (!disabled) setOpen(true); }}
            >
                {/* Decorative ▷ cue — a lucide glyph, never a Unicode character, and hidden from AT so the
                    accessible name stays exactly the guide's title. */}
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                {HELP_TITLE}
            </Button>
            {/* Persistent accessible explanation while disabled — meaning is carried by text, not styling. */}
            {disabled && (
                <span id="freestyle-help-disabled-reason" className="sr-only">{HELP_DISABLED_REASON}</span>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent
                    // Desktop: centered partial dialog ~600px. Mobile: bottom sheet (full-width, anchored to
                    // the bottom, rounded top). Scrollable when content exceeds the viewport.
                    // Desktop: centered partial dialog ~600px (base primitive positioning). Mobile: a
                    // bottom sheet. The shared DialogContent hardcodes centered `left/top-[50%]` +
                    // `translate-[-50%]`; `!important` mobile overrides are required so the bottom-anchored,
                    // full-width sheet reliably wins over those base utilities regardless of class ordering.
                    // `!duration-0` neutralizes the shared primitive's fade/zoom ENTER animation. The panel
                    // background (`bg-background`) is opaque, but the animated fade-in renders it briefly
                    // translucent, letting the page bleed through; disabling the timing makes it fully opaque
                    // the instant it opens (mirrors the STT menu's `opaque` treatment for the same reason).
                    className="!duration-0 max-h-[85vh] overflow-y-auto sm:max-w-[600px] max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0 max-sm:!w-auto max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-b-none max-sm:!rounded-t-xl"
                    data-testid="freestyle-help-overlay"
                    // Guarantee focus returns to the trigger after close (Escape / close button / outside).
                    onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus(); }}
                >
                    <DialogTitle>{HELP_TITLE}</DialogTitle>
                    <DialogDescription>{HELP_INTRO}</DialogDescription>
                    <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-foreground/85" data-testid="freestyle-help-steps">
                        {HELP_STEPS.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ol>
                    <p className="mt-3 text-sm text-muted-foreground" data-testid="freestyle-help-feedback">
                        {HELP_FEEDBACK}
                    </p>
                </DialogContent>
            </Dialog>
        </div>
    );
}
