import React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useAnalytics } from '../hooks/useAnalytics';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import { toast } from 'sonner';
import { useUserProfile } from '@/hooks/useUserProfile';
import { isPro } from '@/constants/subscriptionTiers';
import { Button } from '@/components/ui/button';
import { Mic, BarChart } from 'lucide-react';

/**
 * AnalyticsPage is the CONTAINER component for the analytics feature.
 *
 * ARCHITECTURE NOTE (Gap Analysis 2025-12-22):
 * This component follows the Container/Presentational pattern:
 * - It fetches ALL data (via useAnalytics, useUserProfile)
 * - It passes ALL data as props to AnalyticsDashboard (PRESENTATIONAL)
 * - AnalyticsDashboard does NOT fetch its own data
 *
 * @see AnalyticsDashboard.tsx - Presentational component that receives data via props
 */

// --- Sub-components ---

const PageHeader: React.FC<{ isPro: boolean; sessionId?: string; onUpgrade: () => void }> = ({ isPro, sessionId, onUpgrade }) => {

    // Different heading and description based on whether viewing a specific session
    const isSessionView = !!sessionId;
    const heading = isSessionView ? 'Session Analysis' : 'Your Dashboard';
    const description = isSessionView
        ? 'A detailed breakdown of your recent practice session.'
        : "Here's an overview of your progress. Keep it up!";

    return (
        <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="dashboard-heading">{heading}</h1>
            <p className="text-muted-foreground mb-4">{description}</p>

            {/* Plan Banner - Only show on dashboard view, not session view */}
            {!isSessionView && !isPro && (
                <button
                    onClick={onUpgrade}
                    className="w-full flex items-center justify-between bg-secondary hover:bg-secondary/90 text-white px-6 py-3 rounded-full transition-colors"
                    data-testid="analytics-page-upgrade-button"
                >
                    <div className="flex items-center gap-3">
                        <Mic className="w-5 h-5" />
                        <span className="font-medium">Free Plan</span>
                        <span className="text-white/70 hidden sm:inline">|</span>
                        <span className="text-sm text-white/90 hidden sm:inline">Upgrade to Pro for unlimited practice, PDF exports, and detailed analytics</span>
                    </div>
                    <div className="flex items-center gap-2 font-medium">
                        Upgrade to Pro
                    </div>
                </button>
            )}
            {!isSessionView && isPro && (
                <div className="w-full flex items-center justify-center bg-secondary text-gray-900 px-6 py-3 rounded-full">
                    <span className="font-medium">✨ Pro Plan Active</span>
                </div>
            )}
        </div>
    );
};

const AuthenticatedAnalyticsView: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { sessionHistory, overallStats, fillerWordTrends, loading, error } = useAnalytics();
    // const { user } = useAuthProvider();
    const { data: profile, isLoading: isProfileLoading, error: profileError } = useUserProfile();

    console.log('[AnalyticsPage] Rendering. sessionId:', sessionId, 'loading:', loading, 'isProfileLoading:', isProfileLoading);
    console.log('[AnalyticsPage] sessionHistory length:', sessionHistory?.length, 'error:', error, 'profileError:', profileError);

    const handleUpgrade = async () => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error("Supabase client not available");
            const { data, error } = await supabase.functions.invoke('stripe-checkout');
            if (error) throw error;
            if (data?.checkoutUrl) {
                window.location.href = data.checkoutUrl;
            } else {
                throw new Error("No checkout URL returned");
            }
        } catch (err: unknown) {
            logger.error({ err }, 'Error creating Stripe checkout session:');
            toast.error('Unable to start upgrade process. Please try again or contact support.');
        }
    };

    const isProUser = isPro(profile?.subscription_status);

    // Show loading state while fetching data
    if (loading || isProfileLoading) {
        console.log('[AnalyticsPage] Showing loading state');
        return (
            <div className="flex items-center justify-center py-16">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading analytics...</p>
                </div>
            </div>
        );
    }

    // Show error state if either query failed
    if (error || profileError) {
        return (
            <div className="text-center py-16">
                <h2 className="text-2xl font-semibold mb-4 text-destructive">Error Loading Analytics</h2>
                <p className="text-muted-foreground mb-6">
                    {error?.message || profileError?.message || 'Something went wrong. Please try again.'}
                </p>
                <Button onClick={() => window.location.reload()}>
                    Refresh Page
                </Button>
            </div>
        );
    }

    // Show "Session Not Found" if viewing a specific session that doesn't exist
    const sessionExists = sessionId ? sessionHistory.some(s => s.id === sessionId) : true;
    if (sessionId && !sessionExists && !loading && !error) {
        return (
            <div className="text-center py-16">
                <h2 className="text-2xl font-semibold mb-4">Session Not Found</h2>
                <p className="text-muted-foreground mb-6">We couldn't find the session you're looking for.</p>
                <Button asChild>
                    <NavLink to="/analytics"><BarChart className="mr-2 h-4 w-4" /> View Dashboard</NavLink>
                </Button>
            </div>
        );
    }
    return (
        <div>
            <PageHeader isPro={isProUser} sessionId={sessionId} onUpgrade={handleUpgrade} />
            <AnalyticsDashboard
                profile={profile || null}
                sessionHistory={sessionHistory || []}
                overallStats={overallStats}
                fillerWordTrends={fillerWordTrends}
                loading={loading}
                error={error}
                onUpgrade={handleUpgrade}
            />
        </div>
    );
};

// --- Main Component ---

export const AnalyticsPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-gradient-subtle pt-20">
            <div className="max-w-7xl mx-auto px-8 md:px-12 py-10">
                <AuthenticatedAnalyticsView />
            </div>
        </div>
    );
};

export default AnalyticsPage;
