import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnalyticsDashboard, AnalyticsDashboardSkeleton } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, Sparkles } from 'lucide-react';

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
    const { sessions, loading } = useSessionManager();
    const { user, profile } = useAuth();
    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';

    if (loading) {
        return (
            <div>
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground">Your Dashboard</h1>
                    <p className="mt-2 text-base text-muted-foreground">Here's an overview of your progress. Keep it up!</p>
                </div>
                <AnalyticsDashboardSkeleton />
            </div>
        );
    }

    // The empty state is now handled inside AnalyticsDashboard
    if (sessions.length === 0) {
        return <AnalyticsDashboard sessionHistory={[]} profile={profile} />;
    }

    return (
        <>
            {user && !isPro && <UpgradeBanner />}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-foreground">Your Dashboard</h1>
                <p className="mt-2 text-base text-muted-foreground">Here's an overview of your progress. Keep it up!</p>
            </div>
            <AnalyticsDashboard sessionHistory={sessions} profile={profile} />
        </>
    );
};

export const AnalyticsPage = () => {
    return (
        <div className="container mx-auto px-component-px py-10">
            <AuthenticatedAnalyticsView />
        </div>
    );
};
