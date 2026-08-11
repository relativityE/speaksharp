import { Link } from 'react-router-dom';

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

export const TermsPage = () => (
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
        body: 'SpeakSharp is currently a controlled free beta. No card or checkout is required. Every customer recording uses Private on-device transcription; account tiers may differ only in usage limits or future coaching features, not transcription privacy.',
      },
      {
        heading: 'Payments',
        body: 'Paid enrollment and checkout are not currently offered during the controlled beta. If paid plans are introduced later, their price, limits, cancellation, and refund terms will be shown before any charge.',
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
        body: 'Session data is used to provide transcripts, coaching, progress, reports, reliability monitoring, and support. SpeakSharp keeps transcript text for the two newest transcript-bearing saved sessions. Older transcript text expires after the progress evidence needed to preserve your comparisons is complete; it may remain temporarily while that evidence is still pending. Non-content session metrics may remain for progress.',
      },
      {
        heading: 'Service Providers',
        body: 'SpeakSharp may use providers such as Supabase, Stripe, PostHog, Sentry, and Gemini for authentication, billing infrastructure, analytics, monitoring, and coaching. Private speech audio is not sent to those providers for transcription. When a server-backed coaching feature is used, the minimum text required for that feature may be processed under this policy.',
      },
      {
        heading: 'Control',
        body: 'You can choose whether to practice, delete your account, and use Report Issue for account or data questions. There is no customer-facing transcription-mode selector; every customer practice session uses Private transcription.',
      },
    ]}
  />
);
