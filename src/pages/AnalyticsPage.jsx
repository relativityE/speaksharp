import React from 'react';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';

export const AnalyticsPage = () => {
    const { sessions: sessionHistory, exportSessions } = useSessionManager();

    return (
        <div className="container" style={{ paddingTop: '40px', paddingBottom: '80px' }}>
            <div style={{ marginBottom: '40px' }}>
                <h1 className="h1" style={{ color: 'var(--color-text-primary)' }}>Your Analytics</h1>
                <p className="p">Review your session history and track your progress.</p>
            </div>
            <AnalyticsDashboard sessionHistory={sessionHistory} exportSessions={exportSessions} />
        </div>
    );
};
