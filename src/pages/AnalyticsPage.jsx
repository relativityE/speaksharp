import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import { AnalyticsDashboard, AnalyticsDashboardSkeleton } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, Sparkles, BarChart, Home } from 'lucide-react';

const UpgradeBanner = () => {
    const navigate = useNavigate();
    return (
        <Card className="mb-8 bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg">
            <CardContent className="p-component-py flex items-center justify-between">
                <div className="flex items-center gap-component-gap">
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
    const { sessions, loading } = useSessionManager();
    const { user, profile } = useAuth();
    const [singleSession, setSingleSession] = useState(null);

    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';
    const displaySessions = sessionId ? (singleSession ? [singleSession] : []) : sessions;

    useEffect(() => {
        if (sessionId && sessions.length > 0) {
            const foundSession = sessions.find(s => s.id === sessionId);
            setSingleSession(foundSession);
        } else {
            setSingleSession(null);
        }
    }, [sessionId, sessions]);

    if (loading) {
        return (
            <div>
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground">{sessionId ? "Session Analysis" : "Your Dashboard"}</h1>
                    <p className="mt-2 text-base text-muted-foreground">Loading your data...</p>
                </div>
                <AnalyticsDashboardSkeleton />
            </div>
        );
    }

    if (sessionId && !singleSession && !loading) {
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
        <>
            {user && !isPro && !sessionId && <UpgradeBanner />}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-foreground">{sessionId ? "Session Analysis" : "Your Dashboard"}</h1>
                <p className="mt-2 text-base text-muted-foreground">
                    {sessionId ? "A detailed breakdown of your recent practice session." : "Here's an overview of your progress. Keep it up!"}
                </p>
            </div>
            <AnalyticsDashboard sessionHistory={displaySessions} profile={profile} />
        </>
    );
};

const AnonymousAnalyticsView = () => {
    const location = useLocation();
    const { sessionData } = location.state || {};

    if (!sessionData) {
        return (
            <div className="text-center py-16">
                <h2 className="text-2xl font-semibold mb-4">No Session Data</h2>
                <p className="text-muted-foreground mb-6">Complete a practice session to see your analysis here.</p>
                <Button asChild>
                    <NavLink to="/"><Home className="mr-2 h-4 w-4" /> Start a New Session</NavLink>
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
            <AnalyticsDashboard sessionHistory={[sessionData]} />
        </>
    );
};

export const AnalyticsPage = () => {
    const { user } = useAuth();
    return (
        <div className="container mx-auto px-component-px py-10">
            {user ? <AuthenticatedAnalyticsView /> : <AnonymousAnalyticsView />}
        </div>
    );
};
