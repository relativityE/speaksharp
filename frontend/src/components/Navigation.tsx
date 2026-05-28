import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, BarChart3, Home, LogOut, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { TEST_IDS } from '@/constants/testIds';
import { useLocation, Link, useNavigate } from "react-router-dom";
import { useAuthProvider } from "@/contexts/AuthProvider";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { getEffectiveSubscriptionStatus, isPro } from "@/constants/subscriptionTiers";
import logger from "@/lib/logger";
import {
  buildCheckoutBody,
  trackCheckoutStarted,
  trackConversionCtaClicked,
  trackConversionCtaViewed,
} from "@/services/conversionFunnel";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuthProvider();
  const { data: profile } = useUserProfile();
  const { data: usageLimit } = useUsageLimit();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const effectiveSubscriptionStatus = getEffectiveSubscriptionStatus(usageLimit?.subscription_status, profile);
  const isEffectiveProUser = isPro(effectiveSubscriptionStatus);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const handleUpgrade = async () => {
    if (!session) return;
    setIsUpgrading(true);
    try {
      trackConversionCtaClicked({ source: 'nav_upgrade', plan: 'pro', tier: effectiveSubscriptionStatus });
      trackCheckoutStarted({ source: 'nav_upgrade', plan: 'pro', tier: effectiveSubscriptionStatus });
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(buildCheckoutBody('pro', 'nav_upgrade')),
      });
      const data = await response.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('No checkout URL');
      }
    } catch (err) {
      logger.error({ err }, 'Upgrade failed');
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
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-background/95 border-t border-border surface-shadow z-40 p-2 backdrop-blur-xl">
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


  const isFreeUser = Boolean(session && !isEffectiveProUser);
  const showNavUpgrade = Boolean(
    profile &&
    isFreeUser &&
    location.pathname !== '/session' &&
    location.pathname !== '/pricing' &&
    !location.pathname.startsWith('/analytics')
  );

  useEffect(() => {
    if (showNavUpgrade) {
      trackConversionCtaViewed({ source: 'nav_upgrade', plan: 'pro', tier: effectiveSubscriptionStatus });
    }
  }, [showNavUpgrade, effectiveSubscriptionStatus]);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-40 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2" aria-label="SpeakSharp Home">
              <Mic className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="text-lg font-bold text-foreground tracking-tight">SpeakSharp</span>
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
                      className={isActive ? "bg-muted text-foreground shadow-none" : ""}
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
            <div className="flex items-center space-x-4">
              {session ? (
                <>
                  {showNavUpgrade && (
                    <Button
                      onClick={() => { void handleUpgrade(); }}
                      disabled={isUpgrading}
                      size="sm"
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cta-shadow"
                      data-testid="nav-upgrade-button"
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
                  {session && isEffectiveProUser && (
                    <Badge
                      variant="secondary"
                      className="bg-amber-100 text-amber-900 border border-amber-200 shadow-none animate-in fade-in zoom-in duration-300 px-3 py-1"
                      data-testid={TEST_IDS.PRO_BADGE}
                    >
                      <Zap className="w-3 h-3 mr-1 fill-current" />
                      PRO
                    </Badge>
                  )}
                  <span className="hidden md:inline text-sm text-muted-foreground">
                    {session.user?.email}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => { void handleSignOut(); }} data-testid={TEST_IDS.NAV_SIGN_OUT_BUTTON}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground transition-colors">
                    <Link to="/auth">Sign In</Link>
                  </Button>
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-5 h-9 rounded-xl cta-shadow" asChild>
                    <Link to="/auth/signup">Get Started</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      {session && location.pathname !== '/session' && <MobileNav />}
    </>
  );
};

export default Navigation;
