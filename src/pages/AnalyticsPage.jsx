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
        <div className="container session-page analytics-page">
            <div className="header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '20px 0' }}>
                <div className="icon-home-analytics">
                    <a onClick={() => navigate('/')}>&#8962;</a>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h1>Analytics</h1>
                    <p className="text-tagline font-size-analytics-tagline">Review your session history and progress</p>
                </div>
            </div>

            <AnalyticsDashboard sessionHistory={sessionHistory} />

            <div style={{ textAlign: 'left', marginTop: '20px' }}>
                <a onClick={handleDownload} className="font-size-analytics-download" style={{ cursor: 'pointer', textDecoration: 'underline', color: '#3b82f6' }}>Download History</a>
            </div>
        </div>
    );
};
