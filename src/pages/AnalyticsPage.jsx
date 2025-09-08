import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import { AnalyticsDashboard, AnalyticsDashboardSkeleton } from '../components/AnalyticsDashboard';
import { useSession } from '../contexts/SessionContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, Sparkles, BarChart, Home, Settings } from 'lucide-react';

const UpgradeBanner = () => {
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
                <Button variant="secondary" className="bg-white text-purple-600 hover:bg-gray-100" onClick={() => navigate('/#pricing')}>
                    <Zap className="w-4 h-4 mr-2" />
                    Upgrade Now
                </Button>
            </CardContent>
        </Card>
    );
};

const AuthenticatedAnalyticsView = () => {
    const { sessionId } = useParams();
    const { sessionHistory, loading, error } = useSession();
    const { user, profile } = useAuth();
    const [singleSession, setSingleSession] = useState(null);

    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';
    const displaySessions = sessionId ? (singleSession ? [singleSession] : []) : sessionHistory;

    useEffect(() => {
        if (sessionId && sessionHistory.length > 0) {
            const foundSession = sessionHistory.find(s => s.id === sessionId);
            setSingleSession(foundSession);
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
                    <h1 className="text-3xl font-bold text-foreground">{sessionId ? "Session Analysis" : "Your Dashboard"}</h1>
                    <p className="mt-2 text-base text-muted-foreground">
                        {sessionId ? "A detailed breakdown of your recent practice session." : "Here's an overview of your progress. Keep it up!"}
                    </p>
                </div>
                <AnalyticsDashboard
                    sessionHistory={displaySessions}
                    profile={profile}
                    loading={loading}
                    error={error}
                />
            </div>
        </div>
    );
};

const AnonymousAnalyticsView = () => {
    const location = useLocation();
    const { sessionHistory } = location.state || {};

    if (!sessionHistory || sessionHistory.length === 0) {
        return (
            <div className="text-center py-16">
                <h2 className="text-2xl font-semibold mb-4">No Session Data</h2>
                <p className="text-muted-foreground mb-6">Complete a practice session to see your analysis here.</p>
                <Button asChild>
                    <NavLink to="/session"><Home className="mr-2 h-4 w-4" /> Start a New Session</NavLink>
                </Button>
            </div>
        );
    }

    return (
        <>
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-foreground">Session Analysis</h1>
                <p className="mt-2 text-base text-muted-foreground">Here's the analysis of your practice session. Sign up to save your progress!</p>
            </div>
            <AnalyticsDashboard
                sessionHistory={sessionHistory}
                profile={null}
                loading={false}
                error={null}
            />
        </>
    );
};

export const AnalyticsPage = () => {
    const { user } = useAuth();
    const isDevUser = import.meta.env.VITE_DEV_USER === 'true';

    return (
        <div className="container mx-auto px-4 py-10">
            {(user && !isDevUser) ? <AuthenticatedAnalyticsView /> : <AnonymousAnalyticsView />}
        </div>
    );
};
