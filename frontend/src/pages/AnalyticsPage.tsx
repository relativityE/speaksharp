import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { NavLink, useParams } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useAnalytics } from '../hooks/useAnalytics';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import { toast } from '@/lib/toast';
import { useUserProfile } from '@/hooks/useUserProfile';
import { isPro } from '@/constants/subscriptionTiers';
import { Button } from '@/components/ui/button';
import { Mic, BarChart } from 'lucide-react';
import { IS_TEST_ENVIRONMENT, E2E_SESSION_DATA_LOADED_FLAG } from '@/config/env';
import { useQueryClient } from '@tanstack/react-query';
import { calculateWordErrorRate } from '@/lib/wer';

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

const PageHeader: React.FC<{ isPro: boolean; sessionId?: string; onUpgrade: () => void }> = ({ isPro, sessionId, onUpgrade }) => {

    // Different heading and description based on whether viewing a specific session
    const isSessionView = !!sessionId;
    const heading = isSessionView ? 'Session Analysis' : 'Your Progress';
    const description = isSessionView
        ? 'A detailed breakdown of your recent practice session.'
        : 'Track your speaking improvement over time.';

    return (
        <div className="mb-10">
            <h1 className="text-4xl font-extrabold text-foreground mb-3 tracking-tight" data-testid="dashboard-heading">
                {heading.split(' ').map((word, i) => i === 1 ? <span key={i} className="text-gradient-cyan">{word} </span> : word + ' ')}
            </h1>
            <p className="text-muted-foreground text-lg mb-8">{description}</p>

            {/* Plan Banner - Only show on dashboard view, not session view */}
            {!isSessionView && !isPro && (
                <div
                    className="w-full glass-strong rounded-2xl p-6 glow-secondary border-secondary/20 flex flex-col sm:flex-row items-center justify-between gap-6"
                    data-testid="analytics-page-upgrade-banner"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-secondary/20 rounded-2xl flex items-center justify-center text-secondary">
                            <Mic className="w-6 h-6" />
                        </div>
                        <div className="text-left">
                            <h3 className="font-bold text-xl text-foreground">Unlock Full Insights</h3>
                            <p className="text-sm text-muted-foreground">Upgrade to Pro for unlimited sessions and advanced pattern analysis.</p>
                        </div>
                    </div>
                    <Button
                        onClick={onUpgrade}
                        className="bg-secondary hover:bg-secondary/90 text-secondary-foreground font-bold h-12 px-8 rounded-full transition-all hover:scale-105"
                        data-testid="analytics-page-upgrade-button"
                    >
                        Upgrade Now
                    </Button>
                </div>
            )}
            {!isSessionView && isPro && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-primary text-sm font-semibold">
                    <span className="relative flex h-2 w-2">
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                    Pro Member Analysis
                </div>
            )}
        </div>
    );
};

const AuthenticatedAnalyticsView: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { sessionHistory, overallStats, fillerWordTrends, loading, error } = useAnalytics();
    const { data: profile, isLoading: isProfileLoading, error: profileError } = useUserProfile();

    // Signal to E2E tests when session data has finished loading OR failing
    useEffect(() => {
        if (IS_TEST_ENVIRONMENT && !loading && !isProfileLoading) {
            const win = window as unknown as { [key: string]: boolean };
            win[E2E_SESSION_DATA_LOADED_FLAG] = true;
        }
    }, [loading, isProfileLoading]);

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

    const queryClient = useQueryClient();

    const handleUpdateGroundTruth = async (sessionId: string, groundTruth: string) => {
        try {
            const session = sessionHistory?.find(s => s.id === sessionId);
            if (!session) throw new Error("Session not found");

            const transcript = session.transcript || "";
            const wer = calculateWordErrorRate(groundTruth, transcript);
            // Expert fix: Convert WER (error ratio) to accuracy percentage
            const accuracy = Math.max(0, Math.round((1 - wer) * 100)) / 100;

            const supabase = getSupabaseClient();
            if (!supabase) throw new Error("Supabase client not available");

            const { error: updateError } = await supabase
                .from('sessions')
                .update({
                    ground_truth: groundTruth,
                    accuracy: accuracy
                })
                .eq('id', sessionId);

            if (updateError) throw updateError;

            // Invalidate cache to trigger re-calculation
            await queryClient.invalidateQueries({ queryKey: ["sessionHistory"] });
            await queryClient.invalidateQueries({ queryKey: ["accuracyData"] });

        } catch (err: unknown) {
            logger.error({ err }, 'Error updating ground truth:');
            toast.error('Failed to update metrics. Please try again.');
            throw err;
        }
    };

    const isProUser = isPro(profile?.subscription_status);

    // Show loading state while fetching data
    // Loading state is now handled inside AnalyticsDashboard to provide consistent data-testids for E2E
    const isLoading = loading || isProfileLoading;

    // Show error state if either query failed
    if (error || profileError) {
        return (
            <div className="text-center py-24">
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
            <div className="text-center py-24">
                <h2 className="text-2xl font-semibold mb-4" data-testid="session-not-found-heading">Session Not Found</h2>
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
                loading={isLoading}
                error={error || null}
                onUpgrade={handleUpgrade}
                onUpdateGroundTruth={handleUpdateGroundTruth}
                sessionId={sessionId}
            />
        </div>
    );
};

// --- Main Component ---

export const AnalyticsPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-background pt-20 relative z-10">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="max-w-6xl mx-auto px-6 py-12"
            >
                <AuthenticatedAnalyticsView />
            </motion.div>
        </div>
    );
};

export default AnalyticsPage;
