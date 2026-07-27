import React from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { submitGuidedWaitlist, type GuidedWaitlistSource } from '@/services/guidedWaitlistService';

/**
 * #1061 Guided Rehearsal "Notify me" dialog — the real pre-launch interest capture.
 *
 * Accessibility (Radix Dialog provides focus-trap / Escape / focus-return / background lock):
 *  - accessible title + description, a labelled email field with associated validation copy,
 *  - the submit is disabled while in-flight (no duplicate submission),
 *  - success / error are announced via role="status" / role="alert".
 *
 * Honest states: a failed request NEVER shows a success message. Repeated success is idempotent
 * server-side, so the acknowledgement is the same whether the address was new or already on the list.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Status = 'idle' | 'submitting' | 'success' | 'error';

export function GuidedNotifyDialog({
  open,
  onOpenChange,
  source,
  defaultEmail = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: GuidedWaitlistSource;
  /** Authenticated surface prefills the account email (the user confirms it before submitting). */
  defaultEmail?: string;
}) {
  const [email, setEmail] = React.useState(defaultEmail);
  const [consent, setConsent] = React.useState(false);
  const [status, setStatus] = React.useState<Status>('idle');
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  // Re-seed the prefilled email + reset transient state each time the dialog opens.
  React.useEffect(() => {
    if (open) {
      setEmail(defaultEmail);
      setConsent(false);
      setStatus('idle');
      setFieldError(null);
    }
  }, [open, defaultEmail]);

  const submitting = status === 'submitting';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // guard against duplicate submission
    const normalized = email.trim();
    if (!EMAIL_RE.test(normalized)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    if (!consent) {
      setFieldError('Please confirm you’d like to be notified.');
      return;
    }
    setFieldError(null);
    setStatus('submitting');
    const { ok } = await submitGuidedWaitlist({ email: normalized, consent, source });
    setStatus(ok ? 'success' : 'error');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="guided-notify-dialog">
        <DialogTitle>Get notified about Guided Rehearsal</DialogTitle>
        <DialogDescription>We’ll email you when Guided Rehearsal becomes available.</DialogDescription>

        {status === 'success' ? (
          <p role="status" data-testid="guided-notify-success" className="mt-4 text-sm font-medium text-[color:var(--ss-text)]">
            You’re on the list. We’ll let you know when Guided Rehearsal is available.
          </p>
        ) : (
          <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="guided-notify-email">Email</Label>
              <Input
                id="guided-notify-email"
                data-testid="guided-notify-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? 'guided-notify-error' : undefined}
                disabled={submitting}
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-[color:var(--ss-text)]">
              <input
                type="checkbox"
                data-testid="guided-notify-consent"
                className="mt-0.5"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={submitting}
              />
              <span>Email me when Guided Rehearsal is available. See our{' '}
                <Link to="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
              </span>
            </label>

            {fieldError && (
              <p id="guided-notify-error" role="alert" data-testid="guided-notify-field-error" className="text-sm font-medium text-destructive">
                {fieldError}
              </p>
            )}
            {status === 'error' && (
              <p role="alert" data-testid="guided-notify-error" className="text-sm font-medium text-destructive">
                We couldn’t save your request. Please try again.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" data-testid="guided-notify-submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Notify me'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
