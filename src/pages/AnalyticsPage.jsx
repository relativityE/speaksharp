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

    return (
        <div className="container session-page analytics-page">
            <div className="header">
                <h1>Analytics</h1>
                <p>Review your session history and progress</p>
            </div>

            <AnalyticsDashboard sessionHistory={sessionHistory} />

            <div style={{ textAlign: 'center', marginTop: '40px' }} className="home-page">
                <button className="start-button" onClick={() => navigate('/')}>
                    Back to Home
                </button>
            </div>
        </div>
    );
};
