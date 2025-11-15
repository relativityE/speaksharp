import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { usePracticeHistory } from '../hooks/usePracticeHistory';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, Sparkles, BarChart } from 'lucide-react';
import type { PracticeSession } from '@/types/session';

// --- Sub-components ---

const UpgradeBanner: React.FC = () => {
    const navigate = useNavigate();
    return (
        <Card className="mb-8 bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg">
            <CardContent className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Sparkles className="w-8 h-8 text-yellow-300" />
                    <div>
                        <h3 className="font-bold text-lg">Unlock Your Full Potential</h3>
                        <p className="text-sm opacity-90">Get unlimited practice, advanced analytics, and more with Pro.</p>
                    </div>
                </div>
                <Button variant="secondary" className="bg-white text-purple-600 hover:bg-gray-100" onClick={() => navigate('/#pricing')} data-testid="analytics-page-upgrade-button">
                    <Zap className="w-4 h-4 mr-2" />
                    Upgrade Now
                </Button>
            </CardContent>
        </Card>
    );
};

const AuthenticatedAnalyticsView: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { data: sessionHistory = [], isLoading: loading, error } = usePracticeHistory();
    const { user } = useAuthProvider();
    const { data: profile } = useUserProfile();
    const [singleSession, setSingleSession] = useState<PracticeSession | null>(null);

    const isPro = profile?.subscription_status === 'pro';
    const displaySessions = sessionId ? (singleSession ? [singleSession] : []) : sessionHistory;

    useEffect(() => {
        if (sessionId && sessionHistory.length > 0) {
            const foundSession = sessionHistory.find(s => s.id === sessionId);
            setSingleSession(foundSession || null);
        } else {
            setSingleSession(null);
        }
    }, [sessionId, sessionHistory]);

    if (sessionId && !singleSession && !loading && !error) {
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
            <div className="lg:col-span-4">
                {user && !isPro && !sessionId && <UpgradeBanner />}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground" data-testid="dashboard-heading">{sessionId ? "Session Analysis" : "Your Dashboard"}</h1>
                    <p className="mt-2 text-base text-muted-foreground">
                        {sessionId ? "A detailed breakdown of your recent practice session." : "Here's an overview of your progress. Keep it up!"}
                    </p>
                </div>
                <AnalyticsDashboard
                    sessionHistory={displaySessions}
                    profile={profile || null}
                    loading={loading}
                    error={error}
                />
            </div>
        </div>
    );
};

// --- Main Component ---

export const AnalyticsPage: React.FC = () => {
    return (
        <div className="container mx-auto px-4 py-10">
            <AuthenticatedAnalyticsView />
        </div>
    );
};
