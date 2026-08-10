import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PRODUCT_NAMES } from '@/constants/productNames';
import { ObjectiveSetupForm } from '@/components/session/ObjectiveSetupForm';

/**
 * #1046 slice 5b — the activated Focus Points entry.
 *
 * Hosts the capture form ({@link ObjectiveSetupForm}) in a modal. This REPLACES the pre-launch
 * "coming soon / notify me" dialog: Focus Points is real now, so the card opens this instead of the
 * waitlist. On a saved brief the form calls `onReady`, and the caller binds the brief + routes into the
 * session (the stop seam then finalizes per-point coverage — slice 5a).
 *
 * Radix Dialog supplies the focus trap / Escape / focus-return / background lock. The form owns its own
 * card chrome, so DialogContent is a transparent shell and the required accessible title is sr-only
 * (the form shows its own visible heading).
 */
export function ObjectiveSetupDialog({
    open,
    onOpenChange,
    onReady,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called once the brief is persisted; the caller binds it (with the declared point labels) and
     *  navigates into the session. */
    onReady: (result: { briefId: string; projectId: string; points: string[] }) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-testid="objective-setup-dialog"
                className="max-w-lg border-0 bg-transparent p-0 shadow-none"
            >
                <DialogTitle className="sr-only">Set your {PRODUCT_NAMES.objective}</DialogTitle>
                <ObjectiveSetupForm onReady={onReady} />
            </DialogContent>
        </Dialog>
    );
}

export default ObjectiveSetupDialog;
