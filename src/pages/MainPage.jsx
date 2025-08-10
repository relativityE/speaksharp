import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export const MainPage = () => { // Changed name here
    const navigate = useNavigate();

    const handleStartSession = () => {
        navigate('/session');
    };

    const handleGoToAnalytics = () => {
        navigate('/analytics');
    };

    useEffect(() => {
        const featureCards = document.querySelectorAll('.feature-card');
        const handleMouseEnter = (e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
        };

        const handleMouseLeave = (e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 24px rgba(0, 0, 0, 0.08)';
        };

        featureCards.forEach(card => {
            card.addEventListener('mouseenter', handleMouseEnter);
            card.addEventListener('mouseleave', handleMouseLeave);
        });

        return () => {
            featureCards.forEach(card => {
                card.removeEventListener('mouseenter', handleMouseEnter);
                card.removeEventListener('mouseleave', handleMouseLeave);
            });
        };
    }, []);

    return (
        <div className="container home-page">
            <div className="header">
                <h1>SpeakSharp</h1>
                <p>Cut the clutter. Speak with clarity.</p>
            </div>

            <div className="session-card">
                <h2>
                    <span className="microphone-icon"></span>
                    Session Control
                </h2>
                <p>Start a new session to begin tracking your speech patterns</p>
                <button className="start-button" onClick={handleStartSession}>
                    Start New Session
                </button>
            </div>

            <div className="features-grid">
                <div className="feature-card">
                    <h3>Privacy First</h3>
                    <p>All processing happens on your device using browser APIs. Your speech never leaves your device.</p>
                </div>

                <div className="feature-card" style={{position: 'relative'}}>
                    <h3>Real-time Feedback</h3>
                    <p>Get instant feedback on your speech patterns to improve your communication skills.</p>
                    <div style={{ position: 'absolute', bottom: '20px', right: '20px' }}>
                        <a onClick={handleGoToAnalytics} style={{ cursor: 'pointer', textDecoration: 'underline', color: '#3b82f6', fontWeight: '500', fontSize: '0.875rem' }}>View Analytics</a>
                    </div>
                </div>
            </div>

            <div className="footer">
                <p>SpeakSharp - Powered by browser-based speech recognition</p>
            </div>
        </div>
    );
};
