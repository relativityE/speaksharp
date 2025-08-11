import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';

export const MainPage = () => {
    const navigate = useNavigate();
    const support = useBrowserSupport();

    const handleStartSession = () => {
        navigate('/session');
    };

    const handleGoToAnalytics = () => {
        navigate('/analytics');
    };

    useEffect(() => {
        const featureCards = document.querySelectorAll('.card');
        const handleMouseEnter = (e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
        };

        const handleMouseLeave = (e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 16px rgba(0, 0, 0, 0.08)';
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
        <div className="container">
            <BrowserWarning support={support} />
            <div className="page-header">
                <h1>SpeakSharp</h1>
                <p className="text-tagline">Cut the clutter. Speak with clarity.</p>
            </div>

            <div className="card">
                <h2>
                    <span className="microphone-icon"></span>
                    Session Control
                </h2>
                <p>Start a new session to begin tracking your speech patterns</p>
                <button className="button button-primary" onClick={handleStartSession}>
                    Start New Session
                </button>
            </div>

            <div className="features-grid">
                <div className="card">
                    <h3>Privacy First</h3>
                    <p>All processing happens on your device using browser APIs. Your speech never leaves your device.</p>
                </div>

                <div className="card">
                    <h3>Real-time Feedback</h3>
                    <p>Get instant feedback on your speech patterns to improve your communication skills.</p>
                </div>
            </div>

            <div style={{ marginTop: '20px', width: '100%', textAlign: 'left' }}>
                <a onClick={handleGoToAnalytics}>View Analytics</a>
            </div>

            <div className="page-footer">
                <p>SpeakSharp - Powered by browser-based speech recognition</p>
            </div>
        </div>
    );
};
