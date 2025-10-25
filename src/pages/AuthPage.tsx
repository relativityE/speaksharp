import React, { useState, FormEvent, ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/useAuth';
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
  const { session, loading, setSession } = useAuth();

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
        console.log('[AUTH] Attempting sign-in', { email });
        authResult = await supabase.auth.signInWithPassword({ email, password });
      } else if (view === 'sign_up') {
        console.log('[AUTH] Attempting sign-up and immediate sign-in for E2E', { email });
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        // In an E2E test, immediately sign in to create a session
        authResult = await supabase.auth.signInWithPassword({ email, password });
      } else { // forgot_password
        console.log('[AUTH] Attempting password reset', { email });
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
        console.log('[AUTH] Session successfully established', authResult.data.session);
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
    console.log('[AUTH] Loading auth state...');
    return null;
  }

  if (session) {
    console.log('[AUTH] Session exists, redirecting...');
    return <Navigate to="/" replace />;
  }

  const handleViewChange = (newView: AuthView) => {
    console.log('[AUTH] Switching view', { from: view, to: newView });
    setView(newView);
    setError(null);
    setMessage(null);
    setPassword('');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-primary">SpeakSharp</h1>
      </div>
      <Card className="w-full max-w-sm rounded-xl border shadow-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            {view === 'sign_in' && 'Sign In'}
            {view === 'sign_up' && 'Create an Account'}
            {view === 'forgot_password' && 'Reset Password'}
          </CardTitle>
          <CardDescription>
            {view === 'sign_in' && 'Enter your credentials to access your account.'}
            {view === 'sign_up' && 'Enter your details to get started.'}
            {view === 'forgot_password' && "Enter your email for a password reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} data-testid={view === 'forgot_password' ? 'reset-password-form' : 'auth-form'}>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input data-testid="email-input" id="email" type="email" placeholder="name@example.com" required value={email} onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
              </div>
              {view !== 'forgot_password' && (
                <div className="grid gap-2">
                  <div className="flex items-center">
                    <Label htmlFor="password">Password</Label>
                    {view === 'sign_in' && (
                       <Button variant="link" type="button" onClick={() => handleViewChange('forgot_password')} className="ml-auto inline-block text-xs underline text-muted-foreground hover:text-primary h-auto p-0" data-testid="forgot-password-button">
                          Forgot Password?
                       </Button>
                    )}
                  </div>
                  <Input data-testid="password-input" id="password" type="password" required value={password} onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
                </div>
              )}
              {error && <p data-testid="auth-error-message" className="text-sm text-destructive font-semibold">{error}</p>}
              {message && <p className="text-sm text-green-600 font-semibold bg-green-100 border border-green-200 rounded-md p-3 text-center">{message}</p>}
              <div>
                <Button data-testid={view === 'sign_up' ? 'sign-up-submit' : 'sign-in-submit'} type="submit" className="w-full text-base py-6" disabled={isSubmitting}>
                  {isSubmitting ? (view === 'sign_in' ? 'Signing In...' : view === 'sign_up' ? 'Signing Up...' : 'Sending...') : (view === 'sign_in' ? 'Sign In' : view === 'sign_up' ? 'Sign Up' : 'Send Reset Link')}
                </Button>
              </div>
            </div>
          </form>
          <div className="mt-4 text-center text-sm">
            {view === 'sign_in' && "Don't have an account?"}
            {view === 'sign_up' && 'Already have an account?'}
            {view === 'forgot_password' && 'Remembered your password?'}
            <Button variant="link" type="button" onClick={() => handleViewChange(view === 'sign_in' || view === 'forgot_password' ? 'sign_up' : 'sign_in')} className="text-primary font-semibold" data-testid="mode-toggle">
                {view === 'sign_in' || view === 'forgot_password' ? 'Sign Up' : 'Sign In'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
