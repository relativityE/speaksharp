import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { useSessionManager } from '../hooks/useSessionManager';

export const AnalyticsPage = () => {
    const navigate = useNavigate();
    const { sessions: sessionHistory, exportSessions } = useSessionManager();

    const handleDownload = () => {
        exportSessions();
    };

    return (
        <div className="container">
            <div className="page-header" style={{ position: 'relative' }}>
                <div className="icon-home-analytics">
                    <a onClick={() => navigate('/')}>&#8962;</a>
                </div>
                <h1>Analytics</h1>
                <p className="text-tagline">Review your session history and progress</p>
            </div>

            <AnalyticsDashboard sessionHistory={sessionHistory} />

            <div style={{ textAlign: 'left', marginTop: '20px' }}>
                <a onClick={handleDownload}>Download History</a>
            </div>
        </div>
    );
};
