SpeakSharp Product Requirements Document (PRD)
Version: 6.11
Last Updated: 2025-08-12

1. Executive Summary
1.1 Product Vision
SpeakSharp is a privacy-first, real-time speech analysis tool that empowers users to become more confident and articulate speakers. By providing instant, on-device feedback on filler word usage and speaking pace — without storing user audio — we enable practice that is both effective and secure.

1.2 Business Value & Go-to-Market
Our competitive edge is speed + privacy. Users experience an immediate “aha” moment in their first session, driving free-to-paid conversions.

Go-to-Market Strategy:

Pre-MVP: Build audience via Reddit engagement, early SEO articles, and email capture page.

Launch: Target high-intent users via Google Ads, convert organic Reddit traffic, and launch on Product Hunt.

Growth: Expand organic reach via SEO, run retargeting ads, and partner with coaches & universities.

Primary KPIs:

Homepage → Signup Conversion: 15%+

Free → Paid Conversion: 5%+

Returning Monthly Users: 40%+

Session Completion Rate: 80%+

2. Pricing Model
Tier

Price/Month

Features

Free

$0

2-min trial session, 10 mins/month logged in, last 3 sessions saved, 5 custom words, basic analytics.

Pro

$7.99

Unlimited sessions, unlimited custom words, full analytics history, improvement tracking, PDF export, high-accuracy cloud transcription (optional), download audio locally.

3. Privacy Policy
No server-side storage of audio recordings.

Only store:

Filler word counts

Session duration

Speaking pace

Timestamp

4. Technology Stack
Frontend: React + Vite

Styling: Tailwind CSS + shadcn/ui

Auth/DB: Supabase

Speech Processing: Browser Web Speech API (MVP), Whisper API for Pro accuracy

Payments: Stripe

Error Monitoring: Sentry

Analytics & A/B Testing: PostHog (event tracking, funnels, feature flags)

Hosting: Vercel

4.1 Technical Architecture & Scaling
SpeakSharp is designed from day one to handle multiple concurrent users with minimal server overhead by leveraging a client-heavy architecture supported by scalable cloud services.

Speech-to-Text Handling
Free & Pro (MVP): Browser Web Speech API for real-time transcription.

Processing happens entirely on-device, meaning:

Unlimited concurrent users.

No server CPU usage for transcription.

Low latency feedback.

Pro Cloud Transcription (Optional): Whisper API integration via Supabase Edge Functions or Vercel Serverless Functions.

Auto-scales to handle bursts in concurrent requests.

Role-based access (Pro only) prevents resource abuse.

Rate limits applied to keep costs predictable.

SaaS Web App Architecture
Frontend: React + Vite + Tailwind served via Vercel’s global CDN for low-latency delivery worldwide.

Auth & Database: Supabase Postgres + Realtime WebSocket connections for scalable, concurrent data reads/writes.

Serverless Functions: Handle premium features (cloud transcription, PDF exports) and auto-scale horizontally.

Analytics & Experimentation: PostHog event tracking, funnel analysis, and A/B testing run asynchronously without blocking the user experience.

Payments: Stripe Checkout & Webhooks, processed asynchronously for subscription updates.

Concurrency Scaling Summary
Real-time transcription for free-tier users never touches the backend → essentially infinite concurrency.

Pro-tier Whisper API calls are handled by serverless infrastructure with horizontal scaling.

Managed services (Vercel, Supabase, Stripe) remove the need for custom scaling logic.

5. Roadmap
PHASE 1 — MVP (Weeks 1–3)
Engineering

Marketing & Growth

Week 1:

Week 1:

- [x] Finalize filler detection

- Launch email capture page

- [x] Supabase auth & limits

- Begin Reddit engagement (no selling)

- [ ] Stripe payments



- [ ] PostHog setup (KPI + A/B)



Week 2:

Week 2:

- [x] Landing page w/ real UX

- Publish 1 SEO article

- [ ] Sentry error logging

- Social handles + first demo video

Week 3:

Week 3:

- [x] QA & performance tuning

- Publish 2nd SEO article

- Launch MVP

- Announce beta invite on Reddit

PHASE 2 — GROWTH (Months 1–3)
Engineering

Marketing & Growth

Month 1:

Month 1:

- Progress dashboard

- Product Hunt launch

- Upgrade prompts

- Start Google Ads (high intent)

- Cross-browser QA

- Retargeting via FB/IG

- A/B test landing page

- Continue Reddit outreach

Month 2:

Month 2:

- Weekly summary emails

- Publish 2 SEO posts/month

- Funnel optimization

- Optimize Google Ads keywords

Month 3:

Month 3:

(No new tasks)

(No new tasks)

PHASE 3 — SCALE (Months 6–12)
Engineering

Marketing & Growth

- Offline mode

- Paid partnerships

- AI suggestions

- International SEO

- Team accounts

- Case studies

- Language support



6. Financial Projections & Key Metrics
Assumptions:

Free → Paid Conversion: 5%

Stripe fee: 3% of revenue

Ad spend: $350/month average

Tool + infra costs: $141/month baseline

6.1 Monthly Financial Projection (Conservative)
Mth

MAU

Paid Users

Rev

Infra Costs

Ad Spend

Stripe Fees

Total Costs

Net Profit

Profit %

1

250

13

$103.87

$141

$350

$3.12

$494.12

-$390.25

-375%

3

1,200

60

$479.40

$141

$350

$14.38

$505.38

-$25.98

-5%

6

3,000

150

$1,198.50

$161

$350

$35.96

$546.96

$651.54

54%

6.2 Key Business Metrics
LTV (Lifetime Value)

Definition: The total revenue expected from an average paying user over their lifetime before churn.

Formula: LTV = ARPU × Avg. customer lifespan (months)

Current Estimate:

ARPU = $7.99/month

Avg. customer lifespan = 12 months (conservative)

LTV ≈ $95.88

CAC (Customer Acquisition Cost)

Definition: The cost to acquire one paying customer.

Formula: CAC = Total marketing spend ÷ Number of new paying customers

Current Estimate:

Monthly ad spend = $350

Estimated new paying customers/month = 35

CAC ≈ $10.00

LTV:CAC Ratio

Target: At least 3:1 for healthy SaaS economics.

Current Estimate: LTV 95.88÷ CAC $10.00 = 9.5:1 → Highly favorable.

7. Go-to-Market Assets
7.1 Reddit Post #1 — Educational + Soft CTA
Subreddits: r/PublicSpeaking, r/PresentationSkills
Title: How I cut my filler words in half before my big presentation
Body:
I used to say “uh” and “like” so much that my coworkers started counting. It was brutal.

Here’s what worked for me:

Record yourself (yes, it’s awkward)

Identify your most common filler words

Practice in short bursts with a timer

Review, adjust, repeat

I even built a little browser tool that counts filler words in real time — no audio saved, all private — and it’s made the process way less painful.

Happy to share the link if anyone wants to try the free version.

7.2 Reddit Post #2 — Beta Invite
Subreddits: r/Toastmasters, r/CareerSuccess
Title: Beta testers wanted: Real-time filler word counter for speech practice
Body:
I’m building a privacy-first web app that tracks filler words (um, uh, like, you know) while you speak — right in your browser, no audio stored.

I’m looking for 20 beta testers to help shape the early features.

Free access during beta

Takes <2 minutes to set up

Works on desktop & mobile

Drop a comment or DM me if you’re interested!

7.3 SEO Pillar Article Outline
Topic: How to Stop Saying “Um”
Target Keyword: how to stop saying um
Word count: ~2,500 words

Structure:

Intro: Why filler words hurt your message

The psychology of filler words

Common scenarios where “um” sneaks in

5 proven techniques to reduce filler words

How real-time feedback accelerates improvement

Tools & exercises (include SpeakSharp as #1)

Conclusion: Take action today with free practice tools

8. Success Criteria
Achieve 500 MAUs within 3 months post-launch.

Reach 5% free-to-paid conversion.

Maintain <40% mobile bounce rate.

Achieve profitability within 12 months.
