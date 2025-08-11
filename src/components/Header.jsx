import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { LogOut, UserCircle } from 'lucide-react';

export const Header = () => {
    const { user, signOut } = useAuth();
    const location = useLocation();

    // As per the design spec, the header should be hidden on the sign-in page.
    if (location.pathname === '/auth') {
        return null;
    }

    const navLinkClasses = "flex items-center px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors";
    const activeLinkClasses = "bg-secondary text-foreground";

    return (
        <header className="sticky top-0 z-10 border-b border-card bg-background">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <NavLink to="/" className="text-xl font-bold text-primary">
                    SpeakSharp
                </NavLink>
                <div className="flex items-center gap-4">
                    {user ? (
                        <>
                            <nav className="hidden md:flex items-center gap-2">
                                <NavLink
                                    to="/analytics"
                                    className={({ isActive }) => `${navLinkClasses} ${isActive ? activeLinkClasses : ''}`}
                                >
                                    Analytics
                                </NavLink>
                                <NavLink
                                    to="/session"
                                    className={({ isActive }) => `${navLinkClasses} ${isActive ? activeLinkClasses : ''}`}
                                >
                                    New Session
                                </NavLink>
                            </nav>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={signOut}>
                                    <LogOut size={18} />
                                </Button>
                                <UserCircle size={24} className="text-muted-foreground" />
                            </div>
                        </>
                    ) : (
                        <NavLink to="/auth" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                            Login / Sign Up
                        </NavLink>
                    )}
                </div>
            </div>
        </header>
    );
};
