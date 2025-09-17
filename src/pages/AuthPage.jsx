import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate, useLocation } from 'react-router-dom';

// A map of Supabase error messages to more user-friendly ones.
const friendlyErrors = {
  'Invalid login credentials': 'The email or password you entered is incorrect. Please try again.',
  'User already registered': 'An account with this email already exists. Please sign in or reset your password.',
  'Password should be at least 6 characters': 'Your password must be at least 6 characters long.',
};

const mapError = (message) => {
    return friendlyErrors[message] || 'An unexpected error occurred. Please try again.';
};

export default function AuthPage() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const [view, setView] = useState('sign_in'); // 'sign_in', 'sign_up', or 'forgot_password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage('');

    try {
      let error;
      if (view === 'sign_in') {
        ({ error } = await supabase.auth.signInWithPassword({ email, password }));
      } else if (view === 'sign_up') {
        ({ error } = await supabase.auth.signUp({ email, password }));
        if (!error) setMessage('Success! Please check your email for a confirmation link to complete your registration.');
      } else if (view === 'forgot_password') {
        ({ error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/', // Redirect user back to the app after password reset
        }));
        if (!error) setMessage('If an account with this email exists, a password reset link has been sent.');
      }
      if (error) throw error;
    } catch (error) {
      setError(mapError(error.message));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return null; // or a loading spinner
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  const handleViewChange = (newView) => {
    setView(newView);
    setError(null);
    setMessage('');
    setPassword('');
  }

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
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="email-input"
                />
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
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="password-input"
                  />
                </div>
              )}
              {error && <p className="text-sm text-destructive font-semibold">{error}</p>}
              {message && <p className="text-sm text-green-600 font-semibold bg-green-100 border border-green-200 rounded-md p-3 text-center">{message}</p>}
              <Button
                type="submit"
                className="w-full text-base py-6"
                disabled={isSubmitting}
                data-testid={
                  view === 'sign_in' ? 'sign-in-submit' :
                  view === 'sign_up' ? 'sign-up-submit' : 'reset-password-submit'
                }
              >
                {isSubmitting ?
                  (view === 'sign_in' ? 'Signing In...' :
                   view === 'sign_up' ? 'Signing Up...' : 'Sending...') :
                  (view === 'sign_in' ? 'Sign In' :
                   view === 'sign_up' ? 'Sign Up' : 'Send Reset Link')
                }
              </Button>
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
