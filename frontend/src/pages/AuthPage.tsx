import React, { useState, FormEvent, ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import logger from '../lib/logger';

// --- Types ---
type AuthView = 'sign_in' | 'sign_up' | 'forgot_password';

const friendlyErrors: Record<string, string> = {
  'Invalid login credentials': 'The email or password you entered is incorrect.',
  'User already registered': 'An account with this email already exists. Please sign in.',
  'Password should be at least 6 characters': 'Your password must be at least 6 characters long.',
};

const mapError = (message: string) => {
  try {
    // Handle JSON-formatted Supabase errors
    const parsed = JSON.parse(message);
    if (parsed.message) return friendlyErrors[parsed.message] || parsed.message;
  } catch (err) {
    // Not a JSON string, fall through to direct mapping.
    logger.debug({ err, message }, '[AuthPage] Supabase error message not JSON');
  }
  return friendlyErrors[message] || 'An unexpected error occurred.';
};

export default function AuthPage() {
  const { session, loading, setSession } = useAuthProvider();
  const location = useLocation();

  // Determine initial view from URL path
  const getInitialView = (): AuthView => {
    if (location.pathname.includes('signup')) return 'sign_up';
    return 'sign_in';
  };

  const [view, setView] = useState<AuthView>(getInitialView());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    logger.info({ view }, '[AuthPage] handleSubmit called');

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.error('[AuthPage CRITICAL] Supabase client is null/undefined!');
        throw new Error("Supabase client not available");
      }

      if (password.length < 6 && view !== 'forgot_password') {
        const msg = friendlyErrors['Password should be at least 6 characters'];
        if (view === 'sign_up') {
          setInlineError(msg);
        } else {
          setError(msg);
        }
        setIsSubmitting(false);
        return;
      }

      let authResult;
      if (view === 'sign_in') {
        logger.info({ email }, '[AuthPage] Attempting sign_in');
        authResult = await supabase.auth.signInWithPassword({ email, password });
      } else if (view === 'sign_up') {
        logger.info({ email }, '[AuthPage] Attempting sign_up');
        
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password
        });

        if (signUpError) {
          logger.error({ err: signUpError }, '[AuthPage] Sign-up error');
          // Credentials failed — stay on page, show inline error (red bold)
          setInlineError(mapError(signUpError.message));
          setIsSubmitting(false);
          return;
        }

        // Credentials succeeded. The backend provisions the 60-minute Pro trial.
        setInlineError(null);

        // Post-signup sign-in to get the session (Supabase quirk)
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          logger.error({ err: signInError }, '[AuthPage] Post-signup sign-in failed');
          setInlineError(mapError(signInError.message));
          setIsSubmitting(false);
          return;
        }

        authResult = { data: signInData, error: null };
      } else { // forgot_password
        logger.info({ email }, '[AuthPage] Attempting password reset');
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (resetError) {
          logger.error({ error: resetError }, '[AuthPage] Password reset error');
          throw resetError;
        }
        setMessage('Password reset link sent if account exists.');
        return;
      }

      if (authResult.error) {
        logger.error({ err: authResult.error }, '[AuthPage] Auth error returned by Supabase');
        throw authResult.error;
      }

      if (authResult.data.session) {
        logger.info({ userId: authResult.data.session.user?.id }, '[AuthPage] Session received');
        setSession(authResult.data.session);
      } else if (view === 'sign_up') {
        logger.info('[AuthPage] Sign-up successful, awaiting email confirmation');
        setMessage('Success! Please check your email for a confirmation link.');
      } else {
        logger.error({ data: authResult.data }, '[AuthPage CRITICAL] No session returned from Supabase for sign-in!');
        throw new Error('No session returned from Supabase for sign-in.');
      }
    } catch (err: unknown) {
      logger.error({ err }, '[AuthPage] Fatal error during auth');
      let errorMessage = 'Unknown error';
      if (err instanceof Error) {
        errorMessage = err.message;
        logger.error({ err }, '[AuthPage] Error details');
      } else if (typeof err === 'object' && err !== null && 'message' in err) {
        errorMessage = (err as { message: string }).message;
      }
      setError(mapError(errorMessage));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return null;
  }

  if (session && !isSubmitting) {
    return <Navigate to="/session" replace />;
  }


  const handleViewChange = (newView: AuthView) => {
    setView(newView);
    setError(null);
    setMessage(null);
    setPassword('');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 pt-20 relative overflow-hidden">
      <div className="relative z-10 w-full max-w-md space-y-6">
        <h2 className="text-center text-2xl font-semibold text-foreground">Master your communication skills</h2>

        <Card className="border-[hsl(var(--border-strong))] bg-white shadow-[var(--shadow-card-primary)]">
          <CardHeader className="space-y-1 text-center pb-8">
            <CardTitle className="text-2xl font-bold tracking-tight">
              {view === 'sign_in' && 'Welcome back'}
              {view === 'sign_up' && 'Create Account'}
              {view === 'forgot_password' && 'Reset password'}
            </CardTitle>
            <CardDescription className="text-base">
              {view === 'sign_in' && 'Enter your credentials to access your account'}
              {view === 'forgot_password' && "Enter your email address and we'll send you a reset link"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { void handleSubmit(e); }} data-testid={view === 'forgot_password' ? 'reset-password-form' : 'auth-form'} className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    data-testid="email-input"
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                    className="h-11"
                  />
                </div>
                {view !== 'forgot_password' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      {view === 'sign_in' && (
                        <Button
                          variant="link"
                          type="button"
                          onClick={() => handleViewChange('forgot_password')}
                          className="px-0 font-normal text-xs text-[#4B5563] hover:text-primary h-auto"
                          data-testid="forgot-password-button"
                        >
                          Forgot password?
                        </Button>
                      )}
                    </div>
                    <Input
                      data-testid="password-input"
                      id="password"
                      type="password"
                      autoComplete={view === 'sign_up' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                      className="h-11"
                    />
                  </div>
                )}

                {view === 'sign_up' && (
                  <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <p className="text-sm font-semibold text-foreground">60-minute Pro trial included</p>
                    <p className="text-xs leading-relaxed text-[#4B5563]">
                      New accounts can try Private transcription, analytics, and feedback immediately. Cloud STT is available with Pro. Trial access includes Private STT.
                    </p>
                    {inlineError && (
                      <p
                        className="text-destructive font-semibold text-xs mt-1 animate-in fade-in-50"
                        data-testid="signup-inline-error"
                        role="alert"
                      >
                        {inlineError}
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium animate-in fade-in-50" data-testid="auth-error-message">
                    {error}
                  </div>
                )}

                {message && (
                  <div className="p-3 rounded-md bg-success/12 text-success border border-success/30 text-sm font-medium animate-in fade-in-50 text-center">
                    {message}
                  </div>
                )}

                <Button
                  data-testid={view === 'sign_up' ? 'sign-up-submit' : 'sign-in-submit'}
                  type="submit"
                  className="w-full h-11 text-base font-semibold"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      {view === 'sign_in' ? 'Signing in...' : view === 'sign_up' ? 'Creating account...' : 'Sending link...'}
                    </span>
                  ) : (
                    view === 'sign_in' ? 'Sign In' : view === 'sign_up' ? 'Submit' : 'Send Reset Link'
                  )}
                </Button>
              </div>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-[#4B5563]">Or</span>
              </div>
            </div>

            <div className="text-center space-y-4">
              {view === 'sign_in' ? (
                <div className="space-y-2">
                  <p className="text-sm text-[#4B5563]">Don't have an account?</p>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => handleViewChange('sign_up')}
                    className="w-full h-11 font-semibold border-primary/20 hover:bg-primary/5 hover:text-primary hover:border-primary/50 transition-colors"
                    data-testid="mode-toggle"
                  >
                    Create an account
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-[#4B5563]">Already have an account?</p>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => handleViewChange('sign_in')}
                    className="w-full h-11 font-semibold hover:bg-secondary transition-colors"
                    data-testid="mode-toggle"
                  >
                    Sign in to your account
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-[#4B5563] px-8">
          By clicking continue, you agree to our <a href="#" className="underline underline-offset-4 hover:text-primary">Terms of Service</a> and <a href="#" className="underline underline-offset-4 hover:text-primary">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
