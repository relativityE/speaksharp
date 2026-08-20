import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { TEST_IDS } from '@/constants/testIds';
import { NAV_SECTIONS, navItemClassName, normalizeNavPath, resolveNavSectionId } from "@/config/navSections";
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
import { FaqMenu } from "@/components/faq/FaqMenu";
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
  const hasActiveProductAccess = isPro(effectiveSubscriptionStatus) || hasPaidProEntitlement(profile);
  const isConfirmedPaidUser = hasPaidProEntitlement(profile);

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

  // Each bar is its own navigation landmark and each owns its own aria-current. Only one of
  // the two is ever displayed (the desktop bar is `hidden lg:flex`, i.e. display:none below
  // lg, which removes it from the accessibility tree entirely), so a screen reader never sees
  // two current pages — while the bar the user can actually see always announces one.
  const MobileNav = () => (
    <nav
      aria-label="Primary mobile"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 p-2 backdrop-blur-xl surface-shadow lg:hidden"
    >
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
              {/* Colour alone is not an accessible current-page indicator on mobile either. */}
              <Link to={item.path} aria-current={isActive ? "page" : undefined}>
                <item.icon className="h-5 w-5 mb-1" aria-hidden="true" />
                <span className="text-xs">{item.label}</span>
              </Link>
            </Button>
          );
        })}
      </div>
    </nav>
  );


  const isFreeUser = Boolean(session && !hasActiveProductAccess);
  // These route checks used raw pathname comparisons, which disagreed with the router:
  // react-router matches `/session/` and `/Session` to the `/session` route, so the CTA
  // rendered (and the bottom bar covered the recording UI) on URLs that ARE the session
  // page. They now go through the one shared resolver.
  const showNavUpgrade = Boolean(
    arePaymentsEnabled() &&
    profile &&
    isFreeUser &&
    activeSectionId !== 'session' &&
    activeSectionId !== 'analytics' &&
    normalizeNavPath(location.pathname) !== '/pricing'
  );

  useEffect(() => {
    if (showNavUpgrade) {
      trackConversionCtaViewed({ source: 'nav_upgrade', plan: 'pro', tier: effectiveSubscriptionStatus });
    }
  }, [showNavUpgrade, effectiveSubscriptionStatus]);

  return (
    <>
      {/* The bar itself is the page header (banner landmark); the nav landmarks are the
          labelled <nav> elements inside it. */}
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
              <nav aria-label="Primary" className="hidden items-center space-x-1 lg:flex">
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
                  {/* Header-actions order (PO 2026-08-09): Report issue · FAQ · subscription badge · avatar.
                      FAQ sits BETWEEN Report issue and the subscription designation; the PRO/Upgrade badge
                      sits next to the account identity (avatar) below. */}
                  <IssueReportDialog
                    userId={session.user?.id ?? null}
                    plan={effectiveSubscriptionStatus}
                    sttMode={reportSttMode}
                    runtimeState={reportRuntimeState}
                  />
                  {/* FAQ is an INLINE dropdown, not a page — it opens on whatever page the user is on
                      (including /session) and never navigates away. It lives in the always-visible
                      header actions so it is reachable on every viewport, unlike the desktop-only
                      primary nav and the session-suppressed mobile bar. */}
                  <FaqMenu />
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
                  {session && isConfirmedPaidUser && (
                    <Badge
                      variant="secondary"
                      className="bg-amber-100 text-amber-900 border border-amber-200 shadow-none animate-in fade-in zoom-in duration-300 px-3 py-1"
                      data-testid={TEST_IDS.PRO_BADGE}
                    >
                      <Zap className="w-3 h-3 mr-1 fill-current" />
                      PRO
                    </Badge>
                  )}
                  {/*
                    * Account identity. The full email used to be printed here; at realistic address
                    * lengths it pushed the right-hand action group into the primary nav links and
                    * overflowed the bar horizontally on narrow desktops. An avatar has a fixed width,
                    * so the header geometry no longer depends on how long a user's address is.
                    *
                    * The initial alone is not an accessible name, and a `title` attribute is not a
                    * reliable one, so the element is an image with an explicit aria-label: assistive
                    * tech gets "Signed in as <email>" while the visual header shows only the letter.
                    */}
                  <span
                    role="img"
                    aria-label={`Signed in as ${session.user?.email ?? 'your account'}`}
                    data-testid="nav-account-avatar"
                    className="hidden md:grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--nav-avatar-bg))] text-[hsl(var(--nav-avatar-fg))] text-sm font-bold"
                  >
                    <span aria-hidden="true">
                      {(session.user?.email ?? '?').trim().charAt(0).toUpperCase() || '?'}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => { void handleSignOut(); }} data-testid={TEST_IDS.NAV_SIGN_OUT_BUTTON} aria-label="Sign Out" className="shrink-0 px-2 sm:px-3">
                    <LogOut className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Sign Out</span>
                  </Button>
                </>
              ) : (
                // Signed-out visitors have no primary nav; these are their only nav links, so
                // they get their own landmark rather than sitting loose in the header.
                <nav aria-label="Account" className="flex items-center gap-2 sm:gap-4">
                  <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground transition-colors">
                    <Link to="/auth">Sign In</Link>
                  </Button>
                  <Button size="sm" className="font-semibold px-5 h-9 rounded-xl cta-shadow hover:brightness-95" style={{ background: '#d98a1f', color: '#241503' }} asChild>
                    <Link to="/auth/signup">Get Started</Link>
                  </Button>
                </nav>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      {/* The fixed bottom bar must never cover the live recording UI — including on /session/
          and /Session, which the router resolves to the very same session page. */}
      {session && activeSectionId !== 'session' && <MobileNav />}
    </>
  );
};

export default Navigation;
