import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { Button } from '../components/ui/button';

export const AnalyticsPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const sessionData = location.state?.sessionData;

    return (
        <div>
            <AnalyticsDashboard {...sessionData} />
            <Button onClick={() => navigate('/')} className="mt-4">
                Start New Session
            </Button>
        </div>
    );
};
