import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';

export const AnalyticsPage = () => {
    const navigate = useNavigate();
    const [sessionHistory, setSessionHistory] = useState([]);

    useEffect(() => {
        const storedHistory = JSON.parse(localStorage.getItem('saylessSessionHistory')) || [];
        setSessionHistory(storedHistory);
    }, []);

    const handleDownload = () => {
        const dataStr = JSON.stringify(sessionHistory, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

        const downloadLink = document.createElement('a');
        downloadLink.setAttribute('href', dataUri);
        downloadLink.setAttribute('download', 'sayless_history.json');
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
    };

    return (
        <div className="container session-page analytics-page">
            <div className="header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '20px 0' }}>
                <div style={{ position: 'absolute', left: 0 }}>
                    <a onClick={() => navigate('/')} style={{ cursor: 'pointer', fontSize: '2rem' }}>&#8962;</a>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h1>Analytics</h1>
                    <p style={{ fontStyle: 'italic', fontSize: '4rem' }}>Review your session history and progress</p>
                </div>
            </div>

            <AnalyticsDashboard sessionHistory={sessionHistory} />

            <div style={{ textAlign: 'left', marginTop: '20px' }}>
                <a onClick={handleDownload} style={{ cursor: 'pointer', textDecoration: 'underline', color: '#3b82f6', fontSize: '2rem' }}>Download History</a>
            </div>
        </div>
    );
};
