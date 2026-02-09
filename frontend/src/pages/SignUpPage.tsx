import React, { useState, FormEvent, ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import posthog from 'posthog-js';
import logger from '@/lib/logger';

import { useQueryClient } from '@tanstack/react-query'; // Import query client

export default function SignUpPage() {
    const { session, loading, setSession } = useAuthProvider();
    const queryClient = useQueryClient(); // Initialize query client

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [promoCode, setPromoCode] = useState(''); // New promo code state
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

            // Sign up
            const { error: signUpError } = await supabase.auth.signUp({ email, password });
            if (signUpError) throw signUpError;

            // In an E2E test or auto-confirm environment, we might want to sign in immediately.
            // For now, we'll try to sign in immediately after sign up to see if it works (e.g. if email confirm is off)
            // or just show a success message.

            const { data: signInData } = await supabase.auth.signInWithPassword({ email, password });

            if (signInData.session) {
                setSession(signInData.session);
                // Track successful signup
                posthog.capture('signup_completed', { email_domain: email.split('@')[1] });

                // Apply promo code if provided
                if (promoCode.trim()) {
                    try {
                        const { data: promoData, error: promoError } = await supabase.functions.invoke('apply-promo', {
                            body: { promoCode: promoCode.trim() }
                        });

                        if (promoError) {
                            logger.error({ err: promoError }, 'Failed to apply promo during signup');
                        } else {
                            logger.info({ promoData }, 'Promo applied during signup');
                            // Force refresh of user profile to show Pro status immediately
                            await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
                        }
                    } catch (e) {
                        logger.error({ err: e }, 'Failed to apply promo during signup (exception)');
                    }
                }
            } else {
                // If no session, it likely requires email confirmation
                setMessage('Success! Please check your email for a confirmation link.');
                // Still track signup initiation
                posthog.capture('signup_completed', { requires_confirmation: true });
            }

        } catch (err: unknown) {
            logger.error({ err }, '[AUTH] Error during sign up');
            setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }
    if (session) return <Navigate to="/" replace />;

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 relative overflow-hidden">
            {/* Background Elements - Consistent with SignInPage */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background z-0" />
            <div className="absolute top-0 left-0 w-full h-full bg-[url('/assets/grid-pattern.svg')] opacity-[0.03] z-0 pointer-events-none" />

            <div className="relative z-10 w-full max-w-md space-y-8">
                <div className="text-center space-y-2">
                    <h1 className="text-4xl font-extrabold tracking-tight text-foreground">SpeakSharp</h1>
                    <p className="text-muted-foreground text-lg">Master your communication skills.</p>
                </div>

                <Card className="border-border/50 shadow-xl bg-card/95 backdrop-blur-sm">
                    <CardHeader className="space-y-1 text-center pb-8">
                        <CardTitle className="text-2xl font-bold tracking-tight">Create an account</CardTitle>
                        <CardDescription className="text-base">Enter your email below to create your account</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4" data-testid="auth-form">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="name@example.com"
                                    required
                                    value={email}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="promoCode">Promo Code (Optional)</Label>
                                <Input
                                    id="promoCode"
                                    type="text"
                                    placeholder="Enter code if you have one"
                                    value={promoCode}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setPromoCode(e.target.value)}
                                />
                            </div>

                            {error && (
                                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium" data-testid="auth-error-message">
                                    {error}
                                </div>
                            )}

                            {message && (
                                <div className="p-3 rounded-md bg-green-500/10 text-green-600 text-sm font-medium" data-testid="auth-message">
                                    {message}
                                </div>
                            )}

                            <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={isSubmitting} data-testid="sign-up-submit">
                                {isSubmitting ? 'Creating account...' : 'Create Account'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <div className="text-center text-sm text-muted-foreground">
                    <p>Already have an account? <Button variant="link" asChild><a href="/auth/signin">Sign in</a></Button></p>
                </div>
            </div>
        </div>
    );
}
