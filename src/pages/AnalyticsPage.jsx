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
                <div style={{ position: 'absolute', left: 0 }}>
                    <a onClick={() => navigate('/')} style={{ cursor: 'pointer', fontSize: '1rem' }}>&#8962;</a>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h1>Analytics</h1>
                    <p style={{ fontStyle: 'italic', fontSize: '2rem' }}>Review your session history and progress</p>
                </div>
            </div>

            <AnalyticsDashboard sessionHistory={sessionHistory} />

            <div style={{ textAlign: 'left', marginTop: '20px' }}>
                <a onClick={handleDownload} style={{ cursor: 'pointer', textDecoration: 'underline', color: '#3b82f6', fontSize: '1rem' }}>Download History</a>
            </div>
        </div>
    );
};
