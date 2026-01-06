import { Button } from "@/components/ui/button";
import { Mic, BarChart3, Home, LogOut, Zap } from "lucide-react";
import { useState } from "react";
import { TEST_IDS } from '@/constants/testIds';
import { useLocation, Link, useNavigate } from "react-router-dom";
import { useAuthProvider } from "@/contexts/AuthProvider";
import { useUserProfile } from "@/hooks/useUserProfile";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuthProvider();
  const { data: profile } = useUserProfile();
  const [isUpgrading, setIsUpgrading] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const handleUpgrade = async () => {
    if (!session) return;
    setIsUpgrading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      const data = await response.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('No checkout URL');
      }
    } catch (err) {
      console.error('Upgrade failed:', err);
      setIsUpgrading(false);
    }
  };

  const navItems = [
    {
      path: "/",
      icon: Home,
      label: "Home",
      testId: TEST_IDS.NAV_HOME_LINK
    },
    {
      path: "/session",
      icon: Mic,
      label: "Session",
      testId: TEST_IDS.NAV_SESSION_LINK
    },
    {
      path: "/analytics",
      icon: BarChart3,
      label: "Analytics",
      testId: TEST_IDS.NAV_ANALYTICS_LINK
    },
  ];

  const MobileNav = () => (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card/95 border-t border-border shadow-card z-50 p-2">
      <div className="flex justify-around items-center">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Button
              key={item.path}
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              asChild
              className="flex flex-col h-16"
            >
              <Link to={item.path}>
                <item.icon className="h-5 w-5 mb-1" aria-hidden="true" />
                <span className="text-xs">{item.label}</span>
              </Link>
            </Button>
          );
        })}
      </div>
    </div>
  );


  const isFreeUser = session && profile?.subscription_status === 'free';

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 bg-card/95 backdrop-blur-sm border-b border-border shadow-card z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2" aria-label="SpeakSharp Home">
              <div className="w-8 h-8 bg-gradient-hero rounded-lg flex items-center justify-center">
                <Mic className="h-5 w-5 text-white" aria-hidden="true" />
              </div>
              <span className="text-xl font-bold text-foreground">SpeakSharp</span>
            </Link>

            {/* Navigation Items */}
            {session && (
              <div className="hidden md:flex items-center space-x-1">
                {navItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Button
                      key={item.path}
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      asChild
                    >
                      <Link to={item.path} className="flex items-center space-x-2" data-testid={item.testId}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </Button>
                  );
                })}
              </div>
            )}

            {/* User Actions */}
            <div className="flex items-center space-x-3">
              {session ? (
                <>
                  {isFreeUser && (
                    <Button
                      onClick={handleUpgrade}
                      disabled={isUpgrading}
                      size="sm"
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20 animate-pulse-subtle"
                    >
                      {isUpgrading ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <>
                          <Zap className="h-4 w-4 mr-2" />
                          Upgrade to Pro
                        </>
                      )}
                    </Button>
                  )}
                  <span className="hidden md:inline text-sm text-muted-foreground">
                    {session.user?.email}
                  </span>
                  <Button variant="ghost" size="sm" onClick={handleSignOut} data-testid={TEST_IDS.NAV_SIGN_OUT_BUTTON}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/auth">Sign In</Link>
                  </Button>
                  <Button variant="hero" size="sm" asChild>
                    <Link to="/auth/signup">Get Started</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      {session && <MobileNav />}
    </>
  );
};

export default Navigation;
