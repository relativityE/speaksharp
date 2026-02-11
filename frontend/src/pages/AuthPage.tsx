import React, { useState, FormEvent, ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Session } from '@supabase/supabase-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import logger from '@/lib/logger';

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
  } catch {
    // Not a JSON string, fall through to direct mapping.
  }
  return friendlyErrors[message] || 'An unexpected error occurred.';
};

export default function AuthPage() {
  const { session, loading, setSession } = useAuthProvider();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Determine initial view from URL path
  const getInitialView = (): AuthView => {
    if (location.pathname.includes('signup')) return 'sign_up';
    return 'sign_in';
  };

  const [view, setView] = useState<AuthView>(getInitialView());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'pro'>('free'); // Default to free
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [showPromoField, setShowPromoField] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleProUpgrade = async (currentSession: Session): Promise<boolean | void> => {
    // 1. Priority Check: Handle Promo Bypass Code if provided
    const val = promoCode.trim();
    if (val) {
      logger.debug({ val }, '[AuthPage] Applying promo bypass code');
      try {
        const { error: promoError, data: promoData } = await getSupabaseClient()!.functions.invoke('apply-promo', {
          body: { promoCode: val }
        });

        if (promoError) {
          // Extract message if possible
          let msg = 'Promo failed';
          try {
            const body = await promoError.context.json();
            msg = body.error || msg;
          } catch (e) {
            logger.debug({ e }, '[AuthPage] Could not parse promo error context');
          }
          throw new Error(msg);
        }

        // If successful, redirect to dashboard immediately as Pro
        logger.debug('[AuthPage] Promo upgrade successful!');
        const expiryMsg = promoData?.proFeatureMinutes ? ` for ${promoData.proFeatureMinutes} minutes` : '';
        toast.success(`🎉 Promo code applied! You have Pro features${expiryMsg}.`, { id: 'promo-success' });

        // CRITICAL: Invalidate the userProfile cache so SessionPage fetches fresh Pro status
        await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        logger.debug('[AuthPage] User profile cache invalidated');

        // Don't force reload - allow standard auth flow to proceed
        return true;
      } catch (pe) {
        logger.error({ err: pe }, '[AuthPage] Promo bypass failed');
        const errText = pe instanceof Error ? pe.message : 'Invalid code';
        // Use toast for error so it persists across redirects (since user is already logged in)
        toast.error(`Promo failed: ${errText}. Please try applying it later from the dashboard.`, { id: 'promo-error' });
        // Do NOT fallback to Stripe for this specific bypass attempt, it confuses users
        return false;
      }
    }

    // 2. Fallback: Stripe Checkout
    logger.debug('[AuthPage] Pro plan selected, redirecting to Stripe');
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.access_token}`,
        },
      });
      const data = await response.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return; // Halt logic while redirecting
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (stripeErr) {
      logger.error({ err: stripeErr }, '[AuthPage] Stripe redirect failed');
      setError('Account created, but we couldn\'t start the Pro upgrade. You can upgrade later from the dashboard.');
    }
  };

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
        logger.info('[AuthPage] Password too short, rejecting');
        setError(friendlyErrors['Password should be at least 6 characters']);
        setIsSubmitting(false);
        return;
      }

      let authResult;
      if (view === 'sign_in') {
        logger.info({ email }, '[AuthPage] Attempting sign_in');
        authResult = await supabase.auth.signInWithPassword({ email, password });
      } else if (view === 'sign_up') {
        logger.info({ email, selectedPlan }, '[AuthPage] Attempting sign_up');
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              initial_plan: selectedPlan // Store the intent in user_metadata
            }
          }
        });

        if (signUpError) {
          logger.error({ err: signUpError }, '[AuthPage] Sign-up error');
          throw signUpError;
        }

        // 1. Log the user in to get a session
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          logger.error({ err: signInError }, '[AuthPage] Post-signup sign-in failed');
          throw signInError;
        }

        authResult = { data: signInData, error: null };

        // 2. If Pro was selected...
        if (selectedPlan === 'pro' && signInData.session) {
          const upgradeSuccess = await handleProUpgrade(signInData.session);
          // If handleProUpgrade returns true, it was a promo bypass - continue to setSession
          // If it returns undefined (Stripe redirect), we stop here
          if (!upgradeSuccess) {
            return;
          }
        }
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
      {/* Background Elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background z-0" />
      <div className="absolute top-0 left-0 w-full h-full bg-[url('/assets/grid-pattern.svg')] opacity-[0.03] z-0 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md space-y-6">
        <h2 className="text-center text-2xl font-semibold text-muted-foreground">Master your communication skills</h2>

        <Card className="border-border/50 shadow-xl bg-card/95 backdrop-blur-sm">
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

                {view === 'sign_up' && (
                  <div className="space-y-3 py-2">
                    <Label className="text-sm font-semibold">Choose Your Plan</Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div
                        onClick={() => setSelectedPlan('free')}
                        className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${selectedPlan === 'free' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80'}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold">Free</span>
                          {selectedPlan === 'free' && <div className="h-2 w-2 rounded-full bg-primary" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-tight">Native Browser</p>
                      </div>
                      <div
                        onClick={() => setSelectedPlan('pro')}
                        className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${selectedPlan === 'pro' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80'}`}
                        data-testid="plan-pro-option"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-primary">Pro</span>
                          {selectedPlan === 'pro' && <div className="h-2 w-2 rounded-full bg-primary" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-tight">Cloud and Private options</p>
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowPromoField(!showPromoField)}
                        className="text-sm font-normal text-secondary hover:text-secondary-light transition-colors flex items-center gap-1"
                      >
                        {showPromoField ? 'Hide promo code field' : "🎁 Have a promo code? Click here!"}

                      </button>

                      {showPromoField && (
                        <div className="space-y-2 animate-in slide-in-from-top-1 duration-200">
                          <Label htmlFor="promo" className="text-xs">Bypass Code</Label>
                          <Input
                            id="promo"
                            placeholder="Enter promo code"
                            value={promoCode}
                            onChange={(e) => {
                              setPromoCode(e.target.value);
                              // Auto-select Pro when promo code is entered
                              if (e.target.value.trim() && selectedPlan === 'free') {
                                setSelectedPlan('pro');
                              }
                            }}
                            className="h-9 text-sm"
                            data-testid="promo-code-input"
                          />
                        </div>
                      )}
                    </div>
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
