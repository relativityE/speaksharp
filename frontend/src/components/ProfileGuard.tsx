import React from 'react';
import { useUserProfile } from '../hooks/useUserProfile';
import { useAuthProvider } from '../contexts/AuthProvider';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { ProfileProvider } from '../contexts/ProfileContext';
import { useReadinessStore } from '../stores/useReadinessStore';

interface ProfileGuardProps {
    children: React.ReactNode;
}

/**
 * ARCHITECTURE (Senior Architect):
 * ProfileGuard pattern ensures that authenticated users have a valid profile
 * loaded before the application renders its core logic.
 * 
 * BENEFITS:
 * 1. Deterministic State: Sub-components can assume profile exists if they are rendered.
 * 2. Error Centralization: Profile fetch failures are handled in one place with retry logic.
 * 3. E2E Stability: Provides a clear signal ('app-loaded') for tests to wait for.
 */
export const ProfileGuard: React.FC<ProfileGuardProps> = ({ children }) => {
    const { session, loading: authLoading } = useAuthProvider();
    const { data: profile, isLoading: profileLoading, error: profileError, refetch } = useUserProfile();
    const setReady = useReadinessStore((state) => state.setReady);

    // Signal Profile Readiness for E2E stability
    React.useEffect(() => {
        if (!profileLoading && profile) {
            setReady('profile');
            // Dispatch Architectural Event for E2E listeners (Gold Standard)
            window.dispatchEvent(new CustomEvent('app-hydration-complete', { 
                detail: { profileId: (profile as unknown as { id: string })?.id } 
            }));
        }
    }, [profileLoading, profile, setReady]);

    // 1. Auth is still initializing (Supabase getSession)
    if (authLoading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6" data-testid="auth-loading">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <p className="text-sm font-medium text-muted-foreground animate-pulse">Initializing session...</p>
            </div>
        );
    }

    // 2. No session - transparency mode
    // We don't block UNAUTHENTICATED users (Landing page, Sign In, etc.)
    if (!session) {
        return <>{children}</>;
    }

    // 3. Authenticated but Profile is loading
    if (profileLoading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6" data-testid="app-loading">
                <div className="relative">
                    <div className="absolute inset-0 blur-xl bg-primary/20 rounded-full animate-pulse" />
                    <Loader2 className="h-12 w-12 animate-spin text-primary relative z-10" />
                </div>
                <h2 className="mt-8 text-xl font-bold text-foreground">Readying your experience</h2>
                <p className="mt-2 text-sm text-muted-foreground">Synchronizing your preferences...</p>
            </div>
        );
    }

    // 4. Critical Profile Fetch Error
    if (profileError || !profile) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6" data-testid="app-error">
                <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
                    <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Profile Sync Failed</h2>
                <p className="text-center text-muted-foreground max-w-md mb-8">
                    We couldn't load your profile settings. This is usually a temporary connection issue.
                </p>
                <div className="flex gap-4">
                    <Button variant="outline" onClick={() => window.location.reload()}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh App
                    </Button>
                    <Button onClick={() => { void refetch(); }}>
                        Retry Sync
                    </Button>
                </div>
            </div>
        );
    }

    // 5. Success - Profile available
    const isVerified = !!profile && !profileLoading;

    return (
        <ProfileProvider value={{ profile, isVerified }}>
            {children}
        </ProfileProvider>
    );
};

export default ProfileGuard;
