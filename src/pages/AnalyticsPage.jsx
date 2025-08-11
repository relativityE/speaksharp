import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';

export const AnalyticsPage = () => {
    const navigate = useNavigate();
    const { sessions: sessionHistory, exportSessions } = useSessionManager();

    const handleDownload = () => {
        exportSessions();
    };

    return (
        <div className="container py-8">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="h1">Analytics</h1>
                    <p className="text-muted">Review your session history and progress</p>
                </div>
                <button onClick={() => navigate('/')} className="btn btn-secondary">
                    <Home className="mr-2 h-4 w-4" />
                    Home
                </button>
            </div>

            <AnalyticsDashboard sessionHistory={sessionHistory} />

            <div className="mt-8">
                <button onClick={handleDownload} className="btn btn-outline">
                    Download History
                </button>
            </div>
        </div>
    );
};
