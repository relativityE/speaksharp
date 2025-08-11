import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';
import { Zap, Shield, BarChart } from 'lucide-react'; // Assuming lucide-react for icons

export const MainPage = () => {
    const navigate = useNavigate();
    const support = useBrowserSupport();

    const handleStartSession = () => {
        navigate('/session');
    };

    return (
        <div className="container" style={{ textAlign: 'center', paddingTop: '80px', paddingBottom: '80px' }}>
            <BrowserWarning support={support} />

            <div className="hero-section" style={{ maxWidth: '700px', margin: '0 auto 80px auto' }}>
                <h1 className="h1" style={{ color: 'var(--color-text-primary)', marginBottom: '16px' }}>
                    Speak with Clarity. Build Confidence.
                </h1>
                <p className="p" style={{ fontSize: '1.25rem', marginBottom: '32px' }}>
                    SpeakSharp analyzes your speech in real-time to help you eliminate filler words like "um" and "uh". Become a more confident and articulate speaker today.
                </p>
                <button className="btn btn-primary" style={{ padding: '1rem 2.5rem', fontSize: '1rem' }} onClick={handleStartSession}>
                    Start a Free 2-Minute Session
                </button>
                <p className="p" style={{ fontSize: '0.875rem', marginTop: '16px', color: 'var(--color-text-secondary)' }}>
                    No account required.
                </p>
            </div>

            <div className="social-proof" style={{ marginBottom: '80px' }}>
                <p style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                    TRUSTED BY PROFESSIONALS AT
                </p>
                {/* Placeholder for logos */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '40px', alignItems: 'center', filter: 'grayscale(1) opacity(0.6)' }}>
                    <span>Logo 1</span>
                    <span>Logo 2</span>
                    <span>Logo 3</span>
                    <span>Logo 4</span>
                </div>
            </div>

            <div className="features-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '40px', maxWidth: '1000px', margin: '0 auto' }}>
                <div className="feature-card" style={{ textAlign: 'left' }}>
                    <Zap size={24} color="var(--color-accent)" style={{ marginBottom: '16px' }} />
                    <h3 className="h3" style={{ color: 'var(--color-text-primary)', marginBottom: '8px' }}>Real-time Feedback</h3>
                    <p className="p">Get instant feedback on your filler words as you speak.</p>
                </div>
                <div className="feature-card" style={{ textAlign: 'left' }}>
                    <Shield size={24} color="var(--color-accent)" style={{ marginBottom: '16px' }} />
                    <h3 className="h3" style={{ color: 'var(--color-text-primary)', marginBottom: '8px' }}>Privacy First</h3>
                    <p className="p">All processing happens on your device. Your speech never leaves your browser.</p>
                </div>
                <div className="feature-card" style={{ textAlign: 'left' }}>
                    <BarChart size={24} color="var(--color-accent)" style={{ marginBottom: '16px' }} />
                    <h3 className="h3" style={{ color: 'var(--color-text-primary)', marginBottom: '8px' }}>Track Your Progress</h3>
                    <p className="p">Use our detailed analytics to see how you improve over time.</p>
                </div>
            </div>
        </div>
    );
};
