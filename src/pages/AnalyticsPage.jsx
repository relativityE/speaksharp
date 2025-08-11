import React from 'react';
import { NavLink } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

const AnonymousAnalyticsView = () => (
    <div className="text-center py-20">
        <h2 className="text-3xl font-bold text-light-text mb-4">Unlock Your Full Potential</h2>
        <p className="text-muted-text mb-8 max-w-2xl mx-auto">
            Sign up for a free account to save your session history, track your progress over time, and get detailed insights into your speaking patterns.
        </p>
        <Button asChild size="lg" className="bg-accent-blue text-charcoal hover:bg-accent-blue/90">
            <NavLink to="/auth">Sign Up for Free</NavLink>
        </Button>
        <div className="mt-12 opacity-50 pointer-events-none" aria-hidden="true">
            <p className="mb-4 text-sm tracking-widest uppercase text-muted-text">
                Your future dashboard
            </p>
            <AnalyticsDashboard sessionHistory={[]} />
        </div>
    </div>
);

const AuthenticatedAnalyticsView = () => {
    const { sessions: sessionHistory, exportSessions, loading } = useSessionManager();
    const navigate = useNavigate();

    if (loading) {
        return <p className="text-center text-muted-text">Loading analytics...</p>;
    }

    if (sessionHistory.length === 0) {
        return (
            <div className="text-center py-20">
                <h2 className="text-3xl font-bold text-light-text mb-4">No Session Data</h2>
                <p className="text-muted-text mb-8 max-w-2xl mx-auto">
                    You haven't completed any sessions yet. Start your first session to unlock personalized insights and track your progress.
                </p>
                <Button size="lg" className="bg-accent-blue text-charcoal hover:bg-accent-blue/90" onClick={() => navigate('/session')}>
                    Start New Session
                </Button>
            </div>
        );
    }

    return (
        <>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-4xl font-bold text-light-text">Your Analytics</h1>
                    <p className="mt-1 text-muted-text">Review your session history and track your progress.</p>
                </div>
                <Button variant="outline" onClick={exportSessions} disabled={!sessionHistory || sessionHistory.length === 0}>
                    <Download className="w-4 h-4 mr-2" />
                    Export My Data
                </Button>
            </div>
            <AnalyticsDashboard sessionHistory={sessionHistory} />
            <div className="mt-12 p-6 rounded-lg bg-card-bg border border-accent-blue/20 text-center">
                <h3 className="text-xl font-bold text-light-text mb-2">Want to see your full history?</h3>
                <p className="text-muted-text mb-4">
                    Upgrade to Pro for unlimited data and advanced analytics.
                </p>
                <Button className="bg-accent-blue text-charcoal hover:bg-accent-blue/90">
                    Upgrade to Pro
                </Button>
            </div>
        </>
    );
};

export const AnalyticsPage = () => {
    const { user } = useAuth();

    return (
        <div className="container py-10">
            {user ? <AuthenticatedAnalyticsView /> : <AnonymousAnalyticsView />}
        </div>
    );
};
