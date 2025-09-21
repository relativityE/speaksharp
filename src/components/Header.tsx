import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useSession } from '../contexts/useSession';
import { Button } from './ui/button';
import { SideNav } from './SideNav';
import { Home } from 'lucide-react';

export const Header: React.FC = () => {
    const { user, signOut } = useAuth();
    const { sessionHistory } = useSession();

    const getNavLinkClass = ({ isActive }: { isActive: boolean }) =>
        `flex items-center px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors ${
        isActive ? "bg-secondary text-foreground" : ""
        }`;

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
                        <NavLink to="/session" className={getNavLinkClass}>Session</NavLink>
                        <NavLink to="/pricing" className={getNavLinkClass}>Pricing</NavLink>
                        {sessionHistory && sessionHistory.length > 0 ? (
                            <NavLink to="/analytics" className={getNavLinkClass}>Analytics</NavLink>
                        ) : (
                            <span className={`flex items-center px-3 py-2 rounded-md text-base font-medium text-muted-foreground ${disabledLinkClasses}`} title="Complete a session to view analytics">Analytics</span>
                        )}
                        {user ? (
                            <Button variant="outline" onClick={signOut} data-testid="sign-out-button">Logout</Button>
                        ) : (
                            <Button asChild><NavLink to="/auth" data-testid="sign-in-link">Sign In</NavLink></Button>
                        )}
                    </nav>
                </div>
            </div>
        </header>
    );
};
