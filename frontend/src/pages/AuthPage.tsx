import React, { useState, FormEvent, ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// --- Types ---
type AuthView = 'sign_in' | 'sign_up' | 'forgot_password';

const friendlyErrors: Record<string, string> = {
  'Invalid login credentials': 'The email or password you entered is incorrect.',
  'User already registered': 'An account with this email already exists. Please sign in.',
  'Password should be at least 6 characters': 'Your password must be at least 6 characters long.',
};

const mapError = (message: string) => {
  try {
    // Attempt to parse the message as JSON. Supabase often returns JSON errors in the message string.
    const parsed = JSON.parse(message);
    const friendlyMessage = friendlyErrors[parsed.message];
    if (friendlyMessage) return friendlyMessage;
  } catch {
    // Not a JSON string, fall through to direct mapping.
  }
  return friendlyErrors[message] || 'An unexpected error occurred.';
};

export default function AuthPage() {
  const { session, loading, setSession } = useAuthProvider();

  const [view, setView] = useState<AuthView>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");

      let authResult;
      if (view === 'sign_in') {
        authResult = await supabase.auth.signInWithPassword({ email, password });
      } else if (view === 'sign_up') {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        // In an E2E test, immediately sign in to create a session
        authResult = await supabase.auth.signInWithPassword({ email, password });
      } else { // forgot_password
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (resetError) throw resetError;
        setMessage('Password reset link sent if account exists.');
        return;
      }

      if (authResult.error) {
        console.error('[AUTH] Error returned by Supabase', authResult.error);
        throw authResult.error;
      }

      if (authResult.data.session) {
        setSession(authResult.data.session);
      } else if (view === 'sign_up') {
        setMessage('Success! Please check your email for a confirmation link.');
      } else {
        throw new Error('No session returned from Supabase for sign-in.');
      }
    } catch (err: unknown) {
      console.error('[AUTH] Fatal error during auth', err);
      setError(err instanceof Error ? mapError(err.message) : mapError('Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return null;
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  const handleViewChange = (newView: AuthView) => {
    setView(newView);
    setError(null);
    setMessage(null);
    setPassword('');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background z-0" />
      <div className="absolute top-0 left-0 w-full h-full bg-[url('/assets/grid-pattern.svg')] opacity-[0.03] z-0 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">SpeakSharp</h1>
          <p className="text-muted-foreground text-lg">Master your communication skills.</p>
        </div>

        <Card className="border-border/50 shadow-xl bg-card/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 text-center pb-8">
            <CardTitle className="text-2xl font-bold tracking-tight">
              {view === 'sign_in' && 'Welcome back'}
              {view === 'sign_up' && 'Create an account'}
              {view === 'forgot_password' && 'Reset password'}
            </CardTitle>
            <CardDescription className="text-base">
              {view === 'sign_in' && 'Enter your credentials to access your account'}
              {view === 'sign_up' && 'Enter your email below to create your account'}
              {view === 'forgot_password' && "Enter your email address and we'll send you a reset link"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} data-testid={view === 'forgot_password' ? 'reset-password-form' : 'auth-form'} className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    data-testid="email-input"
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    required
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
                          className="px-0 font-normal text-xs text-muted-foreground hover:text-primary h-auto"
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
                      required
                      value={password}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                      className="h-11"
                    />
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium animate-in fade-in-50" data-testid="auth-error-message">
                    {error}
                  </div>
                )}

                {message && (
                  <div className="p-3 rounded-md bg-green-500/10 text-green-600 text-sm font-medium animate-in fade-in-50 text-center">
                    {message}
                  </div>
                )}

                <Button
                  data-testid={view === 'sign_up' ? 'sign-up-submit' : 'sign-in-submit'}
                  type="submit"
                  className="w-full h-11 text-base font-semibold shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      {view === 'sign_in' ? 'Signing in...' : view === 'sign_up' ? 'Creating account...' : 'Sending link...'}
                    </span>
                  ) : (
                    view === 'sign_in' ? 'Sign In' : view === 'sign_up' ? 'Create Account' : 'Send Reset Link'
                  )}
                </Button>
              </div>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <div className="text-center space-y-4">
              {view === 'sign_in' ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Don't have an account?</p>
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
                  <p className="text-sm text-muted-foreground">Already have an account?</p>
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

        <p className="text-center text-sm text-muted-foreground px-8">
          By clicking continue, you agree to our <a href="#" className="underline underline-offset-4 hover:text-primary">Terms of Service</a> and <a href="#" className="underline underline-offset-4 hover:text-primary">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
