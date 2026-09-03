import { Link } from 'react-router-dom';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';

type LegalPageProps = {
  title: string;
  updated: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
};

const LegalPage = ({ title, updated, sections }: LegalPageProps) => {
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <Link to="/" className="text-sm font-semibold text-primary hover:underline">
            SpeakSharp
          </Link>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="text-sm text-muted-foreground">Last updated: {updated}</p>
          </div>
        </header>
        <div className="space-y-7 text-sm leading-7 text-foreground/90">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">{section.heading}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </article>
    </div>
  );
};

export const TermsPage = () => {
  const paymentsEnabled = arePaymentsEnabled();

  return (
    <LegalPage
    title="Terms of Service"
    updated="August 11, 2026"
    sections={[
      {
        heading: 'Use of SpeakSharp',
        body: 'SpeakSharp is a practice tool for speech transcription, coaching, analytics, and habit building. You are responsible for the content you record and for using the feedback as practice guidance rather than professional advice.',
      },
      {
        heading: 'Accounts and Access',
        body: paymentsEnabled
          ? 'SpeakSharp is one product: the complete Private Practice experience is free for your first 30 days, then $10/month to continue. Every customer recording uses Private on-device transcription; Private is never a paid add-on and there is no feature-limited tier.'
          : 'SpeakSharp is one product: the complete Private Practice experience is free for your first 30 days — no card required. Paid continuation is $10/month and opens when Pro enrollment is enabled. Every customer recording uses Private on-device transcription; Private is never a paid add-on and there is no feature-limited tier.',
      },
      {
        heading: 'Payments',
        body: paymentsEnabled
          ? 'The complete product is free for the first 30 days with no card required; after that, continued access is $10/month. The price and terms are shown before checkout, and cancellation, billing-management, and refund support are available through the paths described in the product. No card is collected until you explicitly upgrade.'
          : 'The complete product is free for the first 30 days with no card required. Paid continuation is $10/month, but checkout is not yet enabled; when it opens, the price, cancellation, and refund terms will be shown before any charge. No card is collected until you explicitly upgrade.',
      },
      {
        heading: 'Acceptable Use',
        body: 'Do not use SpeakSharp to record people without permission, upload unlawful content, interfere with the service, or bypass access controls, quotas, or entitlement checks.',
      },
      {
        heading: 'Changes',
        body: 'These terms may be updated as SpeakSharp moves through launch testing. Continued use after an update means you accept the revised terms.',
      },
    ]}
    />
  );
};

export const PrivacyPage = () => (
  <LegalPage
    title="Privacy Policy"
    updated="August 11, 2026"
    sections={[
      {
        heading: 'What We Process',
        body: 'SpeakSharp processes account details, usage limits, transcripts, session metrics, coaching results, and product analytics needed to run and improve the app.',
      },
      {
        heading: 'Transcription Modes',
        body: 'SpeakSharp uses Private on-device transcription for every customer practice session. After a one-time model setup, speech audio is processed on the user’s device and is not uploaded to a transcription provider.',
      },
      {
        heading: 'How Data Is Used',
        body: 'Session data is used to provide transcripts, coaching, progress, reports, reliability monitoring, and support. Transcript text and coaching results may be stored with saved session records. Retention duration and deletion timing are still being finalized; use Share Feedback for a data-retention request. Non-content session metrics may remain for progress.',
      },
      {
        heading: 'Service Providers',
        body: 'SpeakSharp may use providers such as Supabase, Stripe, PostHog, Sentry, and Gemini for authentication, billing infrastructure, analytics, monitoring, and coaching. Private speech audio is not sent to those providers for transcription. When a server-backed coaching feature is used, the minimum text required for that feature may be processed under this policy.',
      },
      {
        heading: 'Control',
        body: 'You can choose whether to practice and use Share Feedback for account, privacy, retention, or data questions. There is no customer-facing transcription-mode selector; every customer practice session uses Private transcription.',
      },
    ]}
  />
);
