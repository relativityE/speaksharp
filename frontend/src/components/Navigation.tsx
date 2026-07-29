import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { TEST_IDS } from '@/constants/testIds';
import { NAV_SECTIONS, navItemClassName, resolveNavSectionId } from "@/config/navSections";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { useAuthProvider } from "@/contexts/AuthProvider";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { getEffectiveSubscriptionStatus, isPro, hasPaidProEntitlement } from "@/constants/subscriptionTiers";
import { arePaymentsEnabled } from "@/config/appRuntimeConfig";
import logger from "@/lib/logger";
import {
  buildCheckoutBody,
  trackCheckoutStarted,
  trackConversionCtaClicked,
  trackConversionCtaViewed,
} from "@/services/conversionFunnel";
import { IssueReportDialog } from "@/components/IssueReportDialog";
import { toast } from '@/lib/toast';
import { useSessionStore } from "@/stores/useSessionStore";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuthProvider();
  const { data: profile } = useUserProfile();
  const { data: usageLimit } = useUsageLimit();
  // Issue reports are anonymous and never carry the auto transcript (Option C): the user types the
  // exact snippet they want to share inside the dialog. We pass only non-PII session context.
  const reportSttMode = useSessionStore(state => state.sttMode);
  const reportRuntimeState = useSessionStore(state => state.runtimeState);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const effectiveSubscriptionStatus = getEffectiveSubscriptionStatus(usageLimit?.subscription_status, profile);
  // A confirmed paid Pro (profile says 'pro' AND carries Stripe/subscription evidence) must never be
  // treated as Free for the nav CTA — even if check_usage_limit transiently reports a non-'pro' tier
  // (load race, or a usage-limit quirk). getEffectiveSubscriptionStatus prefers usageLimit over the
  // profile, so gating the upgrade button on it alone flashed "Upgrade to Pro" at real Pro users.
  // hasPaidProEntitlement is the canonical paid signal and is unaffected by that override.
  const isEffectiveProUser = isPro(effectiveSubscriptionStatus) || hasPaidProEntitlement(profile);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const handleUpgrade = async () => {
    if (!session) return;
    if (!arePaymentsEnabled()) return; // payments not configured — entry points are hidden, no broken checkout
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
      toast.error('Unable to start checkout. Please try again or contact support if it continues.');
      setIsUpgrading(false);
    }
  };

  // Route -> active nav section is resolved centrally (see @/config/navSections) so no page
  // file ever carries its own active styling, and so the match respects a segment boundary
  // (/session and /session/abc are Session; /session-other is not).
  const activeSectionId = resolveNavSectionId(location.pathname);

  const MobileNav = () => (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-background/95 border-t border-border surface-shadow z-40 p-2 backdrop-blur-xl">
      <div className="flex justify-around items-center">
        {NAV_SECTIONS.map((item) => {
          const isActive = activeSectionId === item.id;
          return (
            <Button
              key={item.id}
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              asChild
              className="flex flex-col h-16"
            >
              {/*
                * No aria-current here on purpose: the mobile bar and the desktop bar are both in
                * the DOM at once (only a CSS media query hides one), so duplicating aria-current
                * would announce two current pages. The desktop primary nav is its sole owner.
                */}
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
    arePaymentsEnabled() &&
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
      {/* The bar itself is the page header; the primary nav landmark is the labelled <nav> inside. */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white border-b border-[#e3e8f0]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo → authenticated home is /practice; anonymous logo stays the public Index. */}
            <Link to={session ? "/practice" : "/"} className="flex items-center space-x-2" aria-label="SpeakSharp Home">
              {/* Brand mark: four ascending orange bars (not a mic glyph). */}
              <span aria-hidden="true" className="flex items-end" style={{ height: 19, gap: 2 }}>
                {[7, 14, 19, 11].map((h, i) => (
                  <span key={i} style={{ width: 3, height: h, background: '#d98a1f', borderRadius: 1 }} />
                ))}
              </span>
              <span className="text-lg font-bold text-foreground tracking-tight">SpeakSharp</span>
            </Link>

            {/* Navigation Items */}
            {session && (
              <nav aria-label="Primary" className="hidden md:flex items-center space-x-1">
                {NAV_SECTIONS.map((item) => {
                  const isActive = activeSectionId === item.id;
                  return (
                    <Link
                      key={item.id}
                      to={item.path}
                      data-testid={item.testId}
                      // Colour alone is not an accessible indicator; aria-current is the
                      // programmatic signal for the current page.
                      aria-current={isActive ? "page" : undefined}
                      // Active adds ONE extra class that changes only background + text colour.
                      // Geometry lives in .nav-item, so the bar cannot reflow on navigation.
                      className={navItemClassName(isActive)}
                    >
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            )}

            {/* User Actions */}
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
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
                  <IssueReportDialog
                    userId={session.user?.id ?? null}
                    plan={effectiveSubscriptionStatus}
                    sttMode={reportSttMode}
                    runtimeState={reportRuntimeState}
                  />
                  <span className="hidden md:inline text-sm text-muted-foreground">
                    {session.user?.email}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => { void handleSignOut(); }} data-testid={TEST_IDS.NAV_SIGN_OUT_BUTTON} aria-label="Sign Out" className="shrink-0 px-2 sm:px-3">
                    <LogOut className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Sign Out</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground transition-colors">
                    <Link to="/auth">Sign In</Link>
                  </Button>
                  <Button size="sm" className="font-semibold px-5 h-9 rounded-xl cta-shadow hover:brightness-95" style={{ background: '#d98a1f', color: '#241503' }} asChild>
                    <Link to="/auth/signup">Get Started</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      {session && location.pathname !== '/session' && <MobileNav />}
    </>
  );
};

export default Navigation;
