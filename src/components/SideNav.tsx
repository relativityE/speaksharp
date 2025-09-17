import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Home, BarChart, User, Menu, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const SideNav: React.FC = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();

    const handleSignOut = () => {
        signOut();
        navigate('/');
    };

    const getNavLinkClass = ({ isActive }: { isActive: boolean }) =>
        `flex items-center px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors ${
        isActive ? 'bg-secondary text-foreground' : ''
        }`;

    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-6 w-6" />
                </Button>
            </SheetTrigger>
            <SheetContent side="left">
                <SheetHeader>
                    <SheetTitle className="text-xl font-bold text-primary">SpeakSharp</SheetTitle>
                </SheetHeader>
                <nav className="mt-8 flex flex-col gap-4">
                    <NavLink to="/" className={getNavLinkClass} end>
                        <Home className="mr-3 h-5 w-5" />
                        Home
                    </NavLink>
                    <NavLink to="/analytics" className={getNavLinkClass}>
                        <BarChart className="mr-3 h-5 w-5" />
                        Analytics
                    </NavLink>
                    {user ? (
                        <Button variant="ghost" onClick={handleSignOut} className="justify-start gap-3 px-3 py-2">
                            <LogOut className="h-5 w-5 text-muted-foreground" />
                            Sign Out
                        </Button>
                    ) : (
                        <NavLink to="/auth" className={getNavLinkClass}>
                            <User className="mr-3 h-5 w-5" />
                            Sign In
                        </NavLink>
                    )}
                </nav>
            </SheetContent>
        </Sheet>
    );
};
