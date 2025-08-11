import React from 'react';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export const AnalyticsPage = () => {
    const { sessions: sessionHistory, exportSessions, loading } = useSessionManager();

    return (
        <div className="container py-10">
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
            {loading ? (
                <p className="text-center text-muted-text">Loading analytics...</p>
            ) : (
                <AnalyticsDashboard sessionHistory={sessionHistory} />
            )}
        </div>
    );
};
