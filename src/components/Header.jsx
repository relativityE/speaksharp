import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';
import { Home, LogOut, UserCircle, Menu } from 'lucide-react';

export const Header = () => {
    const { user, signOut } = useAuth();

    const navLinkClasses = "flex items-center px-4 py-2 rounded-lg text-base font-semibold text-muted-foreground hover:bg-secondary hover:text-primary transition-colors duration-200";
    const activeLinkClasses = "bg-secondary text-primary";

    const getNavLinkClass = ({ isActive }) => `${navLinkClasses} ${isActive ? activeLinkClasses : ''}`;

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
                <NavLink to="/" className="text-2xl font-bold text-primary tracking-tighter">
                    SpeakSharp
                </NavLink>
                <div className="flex items-center gap-4">
                    {user ? (
                        <>
                            {/* Desktop Navigation */}
                            <nav className="hidden md:flex items-center gap-2">
                                <NavLink to="/" className={getNavLinkClass} end>Home</NavLink>
                                <NavLink to="/" className={getNavLinkClass}>New Session</NavLink>
                                <NavLink to="/analytics" className={getNavLinkClass}>Analytics</NavLink>
                            </nav>
                            <div className="hidden md:flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
                                    <LogOut size={20} className="text-muted-foreground hover:text-primary transition-colors" />
                                </Button>
                            </div>

                            {/* Mobile Navigation */}
                            <Sheet>
                                <SheetTrigger asChild>
                                    <Button variant="ghost" size="icon" className="md:hidden">
                                        <Menu className="text-muted-foreground" />
                                        <span className="sr-only">Open menu</span>
                                    </Button>
                                </SheetTrigger>
                                <SheetContent>
                                    <nav className="flex flex-col gap-4 mt-8">
                                        <NavLink to="/" className={getNavLinkClass} end>Home</NavLink>
                                        <NavLink to="/" className={getNavLinkClass}>New Session</NavLink>
                                        <NavLink to="/analytics" className={getNavLinkClass}>Analytics</NavLink>
                                        <Button variant="ghost" onClick={signOut} className="justify-start gap-2 px-3 py-2 text-base font-semibold text-muted-foreground">
                                            <LogOut size={20} />
                                            Sign Out
                                        </Button>
                                    </nav>
                                </SheetContent>
                            </Sheet>
                        </>
                    ) : (
                         <nav className="flex items-center gap-2">
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
