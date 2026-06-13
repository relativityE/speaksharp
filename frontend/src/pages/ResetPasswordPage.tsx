import React, { useEffect, useState, FormEvent, ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import logger from '../lib/logger';

/**
 * ResetPasswordPage — the landing page for the Supabase password-reset link.
 *
 * The reset email link (issued by `resetPasswordForEmail`) carries a provider-generated,
 * short-lived, single-use recovery token. With `detectSessionInUrl: true`, the Supabase client
 * exchanges that token for a recovery session on load (PASSWORD_RECOVERY). This page lets the user
 * set a NEW password via `supabase.auth.updateUser({ password })` — the password is only changed
 * AFTER the provider validates that recovery session. No token is read, logged, or surfaced here.
 *
 * Identity is untouched: this only updates the password credential. `user.id` (UUID), email,
 * billing identity, analytics identity, usage, transcripts, and entitlements are unaffected.
 *
 * Scope: basic reset only. MFA, recovery codes, and advanced/support recovery are backlogged.
 */
type Phase = 'checking' | 'ready' | 'success' | 'invalid';

const MIN_PASSWORD_LENGTH = 6;

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Confirm a valid recovery session exists before showing the form. The reset link establishes one
  // via detectSessionInUrl / PASSWORD_RECOVERY; without it the link is invalid or expired.
  useEffect(() => {
    let active = true;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setPhase('invalid');
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, recoverySession) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || recoverySession) setPhase('ready');
    });

    supabase.auth.getSession()
      .then(({ data }: { data: { session: unknown } }) => {
        if (!active) return;
        setPhase(prev => (prev === 'success' ? prev : (data?.session ? 'ready' : 'invalid')));
      })
      .catch(() => { if (active) setPhase('invalid'); });

    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Auth client not available');
      // Password changes ONLY here, after the provider validates the recovery session.
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        // Never surface the token; an invalid/expired/used link lands here.
        logger.warn({ name: updateError.name }, '[ResetPassword] updateUser rejected');
        setPhase('invalid');
        return;
      }
      setPhase('success');
    } catch (err) {
      logger.warn({ err }, '[ResetPassword] update failed');
      setPhase('invalid');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28">
      <div className="mx-auto flex w-full max-w-md flex-col items-center space-y-6">
        <h2 className="text-center text-2xl font-semibold text-foreground">Reset your password</h2>

        <Card className="w-full">
          <CardHeader className="space-y-1 text-center pb-8">
            <CardTitle className="text-2xl font-bold tracking-tight">Set a new password</CardTitle>
            <CardDescription className="text-base">
              Choose a new password for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {phase === 'success' ? (
              <div className="space-y-4 text-center">
                <p
                  className="p-3 rounded-md bg-success/12 text-success border border-success/30 text-sm font-medium"
                  data-testid="reset-password-success"
                >
                  Your password has been updated. You can sign in with your new password.
                </p>
                <Button asChild className="w-full h-11 text-base font-semibold">
                  <Link to="/auth/signin">Go to sign in</Link>
                </Button>
              </div>
            ) : phase === 'invalid' ? (
              <div className="space-y-4 text-center">
                <p
                  className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium"
                  data-testid="reset-password-invalid"
                >
                  This reset link is invalid or expired. Request a new password reset link.
                </p>
                <Button asChild variant="outline" className="w-full h-11 font-semibold">
                  <Link to="/auth/signin">Request a new reset link</Link>
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(e) => { void handleSubmit(e); }}
                data-testid="set-new-password-form"
                className="space-y-4"
                aria-busy={phase === 'checking'}
              >
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    data-testid="new-password-input"
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    data-testid="confirm-password-input"
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
                    className="h-11"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium" data-testid="reset-password-error">
                    {error}
                  </div>
                )}

                <Button
                  data-testid="update-password-submit"
                  type="submit"
                  className="w-full h-11 text-base font-semibold"
                  disabled={isSubmitting || phase === 'checking'}
                >
                  {isSubmitting ? 'Updating...' : 'Update password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
