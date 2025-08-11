import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, BarChart3, Mic } from 'lucide-react';

const navLinkStyle = {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 'var(--radius)',
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    transition: 'background-color 0.2s, color 0.2s',
};

const activeLinkStyle = {
    backgroundColor: 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
};

export const Header = () => {
    return (
        <header style={{
            padding: '16px 0',
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-bg-primary)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
        }}>
            <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <NavLink to="/" style={{ textDecoration: 'none' }}>
                    <h2 className="h2" style={{ fontSize: '1.5rem', color: 'var(--color-text-primary)', margin: 0 }}>
                        SpeakSharp
                    </h2>
                </NavLink>
                <nav style={{ display: 'flex', gap: '8px' }}>
                    <NavLink
                        to="/"
                        style={({ isActive }) => (isActive ? { ...navLinkStyle, ...activeLinkStyle } : navLinkStyle)}
                    >
                        <Home size={16} style={{ marginRight: '8px' }} />
                        Dashboard
                    </NavLink>
                    <NavLink
                        to="/session"
                        style={({ isActive }) => (isActive ? { ...navLinkStyle, ...activeLinkStyle } : navLinkStyle)}
                    >
                        <Mic size={16} style={{ marginRight: '8px' }} />
                        New Session
                    </NavLink>
                    <NavLink
                        to="/analytics"
                        style={({ isActive }) => (isActive ? { ...navLinkStyle, ...activeLinkStyle } : navLinkStyle)}
                    >
                        <BarChart3 size={16} style={{ marginRight: '8px' }} />
                        Analytics
                    </NavLink>
                </nav>
            </div>
        </header>
    );
};
