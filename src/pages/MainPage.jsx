import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';

export const MainPage = () => { // Changed name here
    const navigate = useNavigate();
    const support = useBrowserSupport();

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
            <BrowserWarning support={support} />
            <div className="header">
                <h1>SpeakSharp</h1>
                <p className="text-tagline font-size-body-main">Cut the clutter. Speak with clarity.</p>
            </div>

            <div className="session-card">
                <h2>
                    <span className="microphone-icon"></span>
                    Session Control
                </h2>
                <p className="font-size-body-main">Start a new session to begin tracking your speech patterns</p>
                <button className="start-button font-size-body-main" onClick={handleStartSession}>
                    Start New Session
                </button>
            </div>

            <div className="features-grid">
                <div className="feature-card">
                    <h3>Privacy First</h3>
                    <p className="font-size-body-main">All processing happens on your device using browser APIs. Your speech never leaves your device.</p>
                </div>

                <div className="feature-card">
                    <h3>Real-time Feedback</h3>
                    <p className="font-size-body-main">Get instant feedback on your speech patterns to improve your communication skills.</p>
                </div>
            </div>

            <div style={{ marginTop: '20px', width: '100%', textAlign: 'left' }}>
                <a onClick={handleGoToAnalytics} className="font-size-body-main" style={{ cursor: 'pointer', textDecoration: 'underline', color: '#3b82f6', fontWeight: '500' }}>View Analytics</a>
            </div>

            <div className="footer">
                <p className="font-size-body-main">SpeakSharp - Powered by browser-based speech recognition</p>
            </div>
        </div>
    );
};
