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
    updated="May 29, 2026"
    sections={[
      {
        heading: 'Use of SpeakSharp',
        body: 'SpeakSharp is a practice tool for speech transcription, coaching, analytics, and habit building. You are responsible for the content you record and for using the feedback as practice guidance rather than professional advice.',
      },
      {
        heading: 'Accounts and Access',
        body: 'Free accounts can use Browser transcription and the included practice limits. Private transcription and Cloud transcription are available according to the plan and trial rules shown in the product. Cloud STT is a Pro feature.',
      },
      {
        heading: 'Payments',
        body: 'Pro checkout is handled by Stripe. Subscription status is applied after Stripe confirms checkout or webhook events. If a payment or configuration issue prevents checkout, contact support before retrying repeated purchases.',
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
    updated="May 29, 2026"
    sections={[
      {
        heading: 'What We Process',
        body: 'SpeakSharp processes account details, usage limits, transcripts, session metrics, coaching results, and product analytics needed to run and improve the app.',
      },
      {
        heading: 'Transcription Modes',
        body: 'Browser transcription runs through the browser speech recognition capability. Private transcription is designed to keep transcription local after setup. Cloud transcription sends audio to a cloud STT provider only when the user selects a Cloud-capable Pro workflow.',
      },
      {
        heading: 'How Data Is Used',
        body: 'Session data is used to provide transcripts, coaching, analytics, reports, reliability monitoring, and support. Transcript data is not used for ads.',
      },
      {
        heading: 'Service Providers',
        body: 'SpeakSharp may use providers such as Supabase, Stripe, PostHog, Sentry, Gemini, and cloud STT services to deliver authentication, billing, analytics, monitoring, coaching, and selected transcription features.',
      },
      {
        heading: 'Control',
        body: 'You can choose which transcription mode to use when available, avoid Cloud transcription by staying with Browser or Private transcription, and contact support for account or data questions.',
      },
    ]}
  />
);
