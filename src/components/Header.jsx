import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import { Button } from './ui/button';
import { SideNav } from './SideNav';
import { Home, LogOut, UserCircle } from 'lucide-react';

export const Header = () => {
    const { user, signOut } = useAuth();
    const { sessionHistory } = useSession();

    const navLinkClasses = "flex items-center px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors";
    const activeLinkClasses = "bg-secondary text-foreground";
    const disabledLinkClasses = "opacity-50 pointer-events-none";

    return (
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <div className="flex items-center gap-4">
                    <SideNav />
                    <NavLink to="/" className="p-2 hover:bg-secondary rounded-md">
                        <Home className="h-6 w-6 text-primary" />
                    </NavLink>
                </div>
                <div className="flex items-center gap-4">
                    <nav className="hidden md:flex items-center gap-4">
                        <NavLink to="/session" className={({ isActive }) => `${navLinkClasses} ${isActive ? activeLinkClasses : ''}`}>Session</NavLink>
                        {sessionHistory && sessionHistory.length > 0 ? (
                            <NavLink to="/analytics" className={({ isActive }) => `${navLinkClasses} ${isActive ? activeLinkClasses : ''}`}>Analytics</NavLink>
                        ) : (
                            <span className={`${navLinkClasses} ${disabledLinkClasses}`} title="Complete a session to view analytics">Analytics</span>
                        )}
                        {user ? (
                            <Button variant="outline" onClick={signOut}>Logout</Button>
                        ) : (
                            <Button asChild><NavLink to="/auth">Sign In</NavLink></Button>
                        )}
                    </nav>
                </div>
            </div>
        </header>
    );
};
