import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Home, LogOut, UserCircle } from 'lucide-react';

export const Header = () => {
    const { user, signOut } = useAuth();
    const location = useLocation();

    // As per the design spec, the header should be hidden on the sign-in page.
    if (location.pathname === '/auth') {
        return null;
    }

    const navLinkClasses = "flex items-center px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors";
    const activeLinkClasses = "bg-secondary text-foreground";

    return (
        <header className="sticky top-0 z-10 border-b border-card bg-background">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <NavLink to="/" aria-label="Home">
                    <Home className="h-6 w-6" />
                </NavLink>
                <div className="flex items-center gap-4">
                    {user ? (
                        <>
                            <nav className="hidden md:flex items-center gap-2">
                                <NavLink
                                    to="/"
                                    className={({ isActive }) => `${navLinkClasses} ${isActive && location.pathname === '/' ? activeLinkClasses : ''}`}
                                    end
                                >
                                    Home
                                </NavLink>
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
                        <nav className="flex items-center gap-4">
                            <NavLink
                                to="/analytics"
                                className={navLinkClasses}
                            >
                                View Analytics
                            </NavLink>
                            <Button asChild>
                                <NavLink to="/auth">Login / Sign Up</NavLink>
                            </Button>
                        </nav>
                    )}
                </div>
            </div>
        </header>
    );
};
