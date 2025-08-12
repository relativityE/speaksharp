import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
    return (
        <div className="container mx-auto px-4 py-10">
            <AuthenticatedAnalyticsView />
        </div>
    );
};
