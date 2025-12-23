import React, { useState, FormEvent, ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail } from 'lucide-react';

// Sign In page – supports both password and magic link
export default function SignInPage() {
    const { session, loading, setSession } = useAuthProvider();
    const navigate = useNavigate();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        setMessage(null);
        try {
            const supabase = getSupabaseClient();
            const { error: authError, data } = await supabase.auth.signInWithPassword({ email, password });
            if (authError) throw authError;
            if (data.session) {
                setSession(data.session);
                // Redirect to session page after successful login
                navigate('/session');
            }
        } catch (err: unknown) {
            // Provide more descriptive error messages for common failure modes
            if (err instanceof TypeError && err.message === 'Failed to fetch') {
                setError('Unable to connect to authentication server. Check your network connection and Supabase configuration.');
            } else {
                setError(err instanceof Error ? err.message : 'An unexpected error occurred');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleMagicLink = async () => {
        if (!email) {
            setError('Please enter your email address first');
            return;
        }
        setIsSendingMagicLink(true);
        setError(null);
        setMessage(null);
        try {
            const supabase = getSupabaseClient();
            const { error: otpError } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: `${window.location.origin}/`
                }
            });
            if (otpError) throw otpError;
            setMessage('Magic link sent! Check your email for a login link.');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to send magic link');
        } finally {
            setIsSendingMagicLink(false);
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
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background z-0" />
            <div className="absolute top-0 left-0 w-full h-full bg-[url('/assets/grid-pattern.svg')] opacity-[0.03] z-0 pointer-events-none" />
            <div className="relative z-10 w-full max-w-md space-y-8">
                <div className="text-center space-y-2">
                    <h1 className="text-4xl font-extrabold tracking-tight text-foreground">SpeakSharp</h1>
                    <p className="text-muted-foreground text-lg">Master your communication skills.</p>
                </div>
                <Card className="border-border/50 shadow-xl bg-card/95 backdrop-blur-sm">
                    <CardHeader className="space-y-1 text-center pb-8">
                        <CardTitle className="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
                        <CardDescription className="text-base">Enter your credentials to access your account</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form onSubmit={handleSubmit} className="space-y-4" data-testid="auth-form">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="name@example.com"
                                    required
                                    value={email}
                                    data-testid="email-input"
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
                                    data-testid="password-input"
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
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
                            <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={isSubmitting} data-testid="sign-in-submit">
                                {isSubmitting ? 'Signing in...' : 'Sign In'}
                            </Button>
                        </form>

                        {/* Divider */}
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-border" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                            </div>
                        </div>

                        {/* Magic Link Button */}
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full h-11 text-base font-medium"
                            onClick={handleMagicLink}
                            disabled={isSendingMagicLink || !email}
                            data-testid="magic-link-button"
                        >
                            <Mail className="mr-2 h-4 w-4" />
                            {isSendingMagicLink ? 'Sending...' : 'Email Magic Link'}
                        </Button>
                    </CardContent>
                </Card>
                <div className="text-center text-sm text-muted-foreground">
                    <p>Don't have an account? <Button variant="link" asChild><a href="/auth/signup">Create an account</a></Button></p>
                </div>
            </div>
        </div>
    );
}
