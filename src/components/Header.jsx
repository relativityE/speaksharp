import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';
import { Home, LogOut, UserCircle, Menu, BarChart2, Clapperboard } from 'lucide-react';

const NavLinks = ({ isMobile, onLinkClick }) => {
    const location = useLocation();
    const navLinkClasses = isMobile
        ? "flex items-center p-4 text-lg font-medium text-foreground hover:bg-secondary transition-colors rounded-lg"
        : "flex items-center px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors";
    const activeLinkClasses = "bg-secondary text-foreground";

    return (
        <>
            <NavLink
                to="/"
                className={({ isActive }) => `${navLinkClasses} ${isActive && location.pathname === '/' ? activeLinkClasses : ''}`}
                onClick={onLinkClick}
                end
            >
                <Home className="mr-3 h-5 w-5" />
                Home
            </NavLink>
            <NavLink
                to="/analytics"
                className={({ isActive }) => `${navLinkClasses} ${isActive ? activeLinkClasses : ''}`}
                onClick={onLinkClick}
            >
                <BarChart2 className="mr-3 h-5 w-5" />
                Analytics
            </NavLink>
            <NavLink
                to="/session"
                className={({ isActive }) => `${navLinkClasses} ${isActive ? activeLinkClasses : ''}`}
                onClick={onLinkClick}
            >
                <Clapperboard className="mr-3 h-5 w-5" />
                New Session
            </NavLink>
        </>
    );
};


export const Header = () => {
    const { user, signOut } = useAuth();
    const location = useLocation();
    const [isSheetOpen, setIsSheetOpen] = useState(false);

    if (location.pathname === '/auth') {
        return null;
    }

    const closeSheet = () => setIsSheetOpen(false);

    return (
        <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <NavLink to="/" aria-label="Home" className="flex items-center gap-2">
                    <img src="/favicon.ico" alt="SpeakSharp Logo" className="h-6 w-6" />
                    <span className="font-bold text-lg">SpeakSharp</span>
                </NavLink>

                {/* Desktop Navigation */}
                <nav className="hidden md:flex items-center gap-4">
                    {user ? (
                        <NavLinks />
                    ) : (
                        <NavLink to="/analytics" className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors">
                            View Analytics
                        </NavLink>
                    )}
                </nav>

                <div className="flex items-center gap-2">
                    {user ? (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" onClick={signOut}>
                                <LogOut size={18} />
                                <span className="sr-only">Sign Out</span>
                            </Button>
                            <UserCircle size={24} className="text-muted-foreground" />
                        </div>
                    ) : (
                        <Button asChild className="hidden md:flex">
                            <NavLink to="/auth">Login / Sign Up</NavLink>
                        </Button>
                    )}

                    {/* Mobile Navigation Trigger */}
                    <div className="md:hidden">
                        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <Menu className="h-6 w-6" />
                                    <span className="sr-only">Open menu</span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="right" className="w-full max-w-sm">
                                <div className="p-4">
                                    <nav className="flex flex-col gap-4">
                                        {user ? (
                                            <NavLinks isMobile onLinkClick={closeSheet} />
                                        ) : (
                                            <>
                                                <NavLink to="/analytics" onClick={closeSheet} className="flex items-center p-4 text-lg font-medium text-foreground hover:bg-secondary transition-colors rounded-lg">
                                                    <BarChart2 className="mr-3 h-5 w-5" />
                                                    View Analytics
                                                </NavLink>
                                                <Button asChild size="lg" className="w-full" onClick={closeSheet}>
                                                    <NavLink to="/auth">Login / Sign Up</NavLink>
                                                </Button>
                                            </>
                                        )}
                                    </nav>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>
            </div>
        </header>
    );
};
