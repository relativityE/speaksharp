import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuickPracticeArt, GuidedRehearsalArt } from '@/components/practice/practiceArt';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';

/**
 * #1061 public product discovery — a LANDING-SPECIFIC two-product section for the anonymous marketing
 * page. It answers "which product fits my need?" for logged-out visitors. It is deliberately NOT the
 * authenticated `/practice` chooser (that card has a different job/interaction contract): here the
 * Freestyle CTA routes through account access preserving intent toward /session, and Guided is a
 * truthful "planned" state with NO CTA, navigation, email capture, or implied availability. Only neutral
 * SVG art primitives are reused from practiceArt.
 */
export const ProductDiscoverySection = () => {
  useEffect(() => {
    trackConversionCtaViewed({ source: 'product_discovery_freestyle' });
  }, []);

  return (
    <section
      aria-label="Choose how you want to practice"
      data-testid="product-discovery-section"
      className="w-full py-12 md:py-14"
    >
      <div className="container px-4 md:px-6 max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight tracking-tight text-center mb-8">
          Choose how you want to practice
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Freestyle Practice — available now */}
          <article
            data-testid="product-discovery-freestyle"
            className="flex flex-col rounded-2xl bg-white border border-border overflow-hidden surface-shadow"
          >
            <div className="h-28 bg-[var(--ss-session-band,theme(colors.teal.50))] px-6 py-4">
              <QuickPracticeArt />
            </div>
            <div className="flex flex-1 flex-col gap-3 p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-bold text-foreground">Freestyle Practice</h3>
                <span
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-success"
                  data-testid="product-discovery-freestyle-status"
                >
                  <CheckCircle2 className="size-4" aria-hidden />
                  Available now
                </span>
              </div>
              <p className="text-sm font-medium leading-relaxed text-foreground/70">
                Speak freely, get actionable feedback, and track your progress over time.
              </p>
              <div className="mt-auto pt-2">
                <Button size="lg" className="h-12 w-full text-base" asChild>
                  <Link
                    to="/auth/signup"
                    state={{ from: { pathname: '/session' } }}
                    data-testid="product-discovery-freestyle-cta"
                    className="flex items-center justify-center gap-2"
                    onClick={() => trackConversionCtaClicked({ source: 'product_discovery_freestyle' })}
                  >
                    Start Freestyle Practice
                    <ArrowRight className="size-5" aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>
          </article>

          {/* Guided Rehearsal — planned, not available yet (no CTA / navigation / email capture) */}
          <article
            data-testid="product-discovery-guided"
            className="flex flex-col rounded-2xl bg-white border border-border overflow-hidden surface-shadow"
          >
            <div className="h-28 bg-[var(--ss-exec-band,theme(colors.violet.100))] px-6 py-4">
              <GuidedRehearsalArt />
            </div>
            <div className="flex flex-1 flex-col gap-3 p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-bold text-foreground">Guided Rehearsal</h3>
                <span
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground/55"
                  data-testid="product-discovery-guided-status"
                  role="status"
                >
                  <Clock className="size-4" aria-hidden />
                  Planned — not available yet
                </span>
              </div>
              <p className="text-sm font-medium leading-relaxed text-foreground/70">
                Prepare for important speaking moments with structured goals and guided practice.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};
