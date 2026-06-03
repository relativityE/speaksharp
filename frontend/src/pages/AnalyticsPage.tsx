import React, { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useAnalytics } from '../hooks/useAnalytics';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '../lib/logger';
import { toast } from '@/lib/toast';
import { useUserProfile } from '@/hooks/useUserProfile';
import { getEffectiveSubscriptionStatus, isPro } from '@/constants/subscriptionTiers';
import { useUsageLimit } from '@/hooks/useUsageLimit';
import { Button } from '@/components/ui/button';
import { Mic, BarChart } from 'lucide-react';
import { useReadinessStore } from '@/stores/useReadinessStore';
import {
    buildCheckoutBody,
    trackCheckoutStarted,
    trackConversionCtaClicked,
    trackConversionCtaViewed,
    type ConversionSource,
} from '@/services/conversionFunnel';


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

// --- Sub-components ---

const PageHeader: React.FC<{ isPro: boolean; sessionId?: string; upgradeLoading: boolean; onUpgrade: () => void }> = ({ isPro, sessionId, upgradeLoading, onUpgrade }) => {

    // Different heading and description based on whether viewing a specific session
    const isSessionView = !!sessionId;
    const heading = isSessionView ? 'Session Analysis' : 'Your Analytics';
    const description = isSessionView
        ? 'A detailed breakdown of your recent practice session.'
        : 'Track your speaking progress and improvements';

    useEffect(() => {
        if (!isSessionView && !isPro) {
            trackConversionCtaViewed({ source: 'analytics_overview_banner', plan: 'pro' });
        }
    }, [isSessionView, isPro]);

    return (
        <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="dashboard-heading">{heading}</h1>
            <p className="mb-4 text-sm font-medium text-foreground/70 sm:text-base">{description}</p>

            {/* Plan Banner - Only show on dashboard view, not session view */}
            {!isSessionView && !isPro && (
                <div
                    className="w-full flex flex-col gap-3 rounded-lg border border-l-4 border-border border-l-primary bg-card px-4 py-4 text-left surface-shadow sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-primary/15 p-2">
                            <Mic className="w-5 h-5 text-primary" />
                        </div>
                        <div className="text-left">
                            <span className="font-bold block text-base">Turn practice into progress</span>
                            <span className="text-sm font-medium text-foreground/70 sm:inline">
                                Pro adds private local transcription, AI coaching, cleaner PDF reports, and deeper session history.
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onUpgrade}
                        disabled={upgradeLoading}
                        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
                        data-testid="analytics-page-upgrade-button"
                    >
                        {upgradeLoading ? 'Starting checkout...' : 'Upgrade to Pro'}
                    </button>
                </div>
            )}
            {!isSessionView && isPro && (
                <div className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground cta-shadow">
                    <span>Pro active</span>
                </div>
            )}
        </div>
    );
};

const AuthenticatedAnalyticsView: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const queryClient = useQueryClient();
    const { sessionHistory, overallStats, fillerWordTrends, loading, error } = useAnalytics();
    const { data: profile, isLoading: isProfileLoading, error: profileError } = useUserProfile();
    const { data: usageLimit } = useUsageLimit();
    const [upgradeLoading, setUpgradeLoading] = useState(false);

    const { setReady } = useReadinessStore();

    // Signal to E2E tests when session data has finished loading OR failing
    useEffect(() => {
        if (!loading && !isProfileLoading) {
            setReady('analytics');
        }
    }, [loading, isProfileLoading, setReady]);

    useEffect(() => {
        if (sessionId) return;
        const sessionJustPersisted =
            typeof document !== 'undefined'
            && document.documentElement.getAttribute('data-session-persisted') === 'true';
        if (!sessionJustPersisted) return;

        void queryClient.invalidateQueries({ queryKey: ['sessionHistory'] });
        void queryClient.invalidateQueries({ queryKey: ['sessionCount'] });
        void queryClient.invalidateQueries({ queryKey: ['analyticsSummary'] });
    }, [queryClient, sessionId]);

    const handleUpgrade = async (source: ConversionSource = 'analytics_overview_banner') => {
        if (upgradeLoading) return;
        setUpgradeLoading(true);

        try {
            trackConversionCtaClicked({ source, plan: 'pro' });
            trackCheckoutStarted({ source, plan: 'pro' });
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error("Supabase client not available");
            const { data, error } = await supabase.functions.invoke('stripe-checkout', {
                body: buildCheckoutBody('pro', source),
            });
            if (error) throw error;
            if (data?.checkoutUrl) {
                window.location.href = data.checkoutUrl;
            } else {
                throw new Error("No checkout URL returned");
            }
        } catch (err: unknown) {
            logger.error({ err }, 'Error creating Stripe checkout session:');
            toast.error('Unable to start upgrade process. Please try again or contact support.');
            setUpgradeLoading(false);
        }
    };

    const effectiveSubscriptionStatus = getEffectiveSubscriptionStatus(usageLimit?.subscription_status, profile);
    const isProUser = isPro(effectiveSubscriptionStatus);

    const handleRetryAnalytics = () => {
        void queryClient.invalidateQueries({ queryKey: ['sessionHistory'] });
        void queryClient.invalidateQueries({ queryKey: ['sessionCount'] });
        void queryClient.invalidateQueries({ queryKey: ['analyticsSummary'] });
        void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    };

    // Show loading state while fetching data
    // Loading state is now handled inside AnalyticsDashboard to provide consistent data-testids for E2E
    const isLoading = loading || isProfileLoading;

    // Show error state if either query failed
    if (error || profileError) {
        logger.error({ err: error || profileError }, '[AnalyticsPage] Failed to load analytics');
        return (
            <div className="text-center py-24">
                <h2 className="text-2xl font-semibold mb-4 text-destructive">Error Loading Analytics</h2>
                <p className="mb-6 font-medium text-foreground/70">
                    We could not load your analytics right now. Retry sync first. If it keeps happening, sign out and back in to refresh your account session.
                </p>
                <Button onClick={handleRetryAnalytics}>
                    Retry Analytics
                </Button>
            </div>
        );
    }

    // Show "Session Not Found" if viewing a specific session that doesn't exist
    const sessionExists = sessionId ? sessionHistory.some(s => s.id === sessionId) : true;
    if (sessionId && !sessionExists && !loading && !error) {
        return (
            <div className="text-center py-24">
                <h2 className="text-2xl font-semibold mb-4" data-testid="session-not-found-heading">Session Not Found</h2>
                <p className="mb-6 font-medium text-foreground/70">We couldn't find the session you're looking for.</p>
                <Button asChild>
                    <NavLink to="/analytics"><BarChart className="mr-2 h-4 w-4" /> View Dashboard</NavLink>
                </Button>
            </div>
        );
    }
    return (
        <div>
            <PageHeader isPro={isProUser} sessionId={sessionId} upgradeLoading={upgradeLoading} onUpgrade={() => { void handleUpgrade('analytics_overview_banner'); }} />
            <AnalyticsDashboard
                profile={profile || null}
                isProUser={isProUser}
                sessionHistory={sessionHistory || []}
                overallStats={overallStats}
                fillerWordTrends={fillerWordTrends}
                loading={isLoading}
                error={error || null}
                onUpgrade={() => { void handleUpgrade('analytics_empty_state'); }}
                sessionId={sessionId}
            />
        </div>
    );
};

// --- Main Component ---

export const AnalyticsPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-background pt-20">
            <div className="max-w-7xl mx-auto px-6 py-8">
                <AuthenticatedAnalyticsView />
            </div>
        </div>
    );
};

export default AnalyticsPage;
