import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const AnonymousAnalyticsView = () => (
    <div className="text-center py-20">
        <h2 className="text-3xl font-bold text-foreground mb-4">See Your Progress in Action</h2>
        <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Create a free account to save your session history, track your improvement over time, and gain detailed insights into your speaking habits.
        </p>
        <Button asChild size="lg">
            <NavLink to="/auth">Create Your Free Account</NavLink>
        </Button>
    </div>
);

const AuthenticatedAnalyticsView = () => {
    const { sessions, loading } = useSessionManager();
    const navigate = useNavigate();

    if (loading) {
        return (
            <div className="text-center py-20">
                <p className="text-muted-foreground">Loading your analytics...</p>
            </div>
        );
    }

    // The empty state is now handled inside AnalyticsDashboard
    if (sessions.length === 0) {
        return <AnalyticsDashboard sessionHistory={[]} />;
    }

    return (
        <>
            <div className="mb-8">
                <h1 className="text-4xl font-bold text-foreground">Your Dashboard</h1>
                <p className="mt-1 text-muted-foreground">Here's an overview of your progress. Keep it up!</p>
            </div>
            <AnalyticsDashboard sessionHistory={sessions} />
        </>
    );
};

export const AnalyticsPage = () => {
    const { user } = useAuth();

    return (
        <div className="container mx-auto px-4 py-10">
            {user ? <AuthenticatedAnalyticsView /> : <AnonymousAnalyticsView />}
        </div>
    );
};
