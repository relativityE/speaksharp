# SpeakSharp Pricing, Limits, and Operational Analysis

## 1. Demonstrated Limits vs Intended Limits

### What limits did our Soak Test Define?
The recent soak test defined the **infrastructure and rate limits** of our backend stack (Supabase + Edge Functions):
- **Auth Provisioning:** Cannot exceed ~30 simultaneous, identical sign-ups from a single IP/Runner without triggering Supabase DDoS protection.
- **Concurrent Live Load:** Successfully verified that **15 users** can concurrently hammer the Edge Functions and Database RPCs (for transcription chunk saves and aggregations). We stayed under the 50 req/sec Free Tier quota limits for Edge Functions.

### What limits are we seeking to define?
We are seeking to define the **User Consumption Limits**—the hard caps on hours of usage to prevent financial ruin from runaway API costs (AssemblyAI).

### Current PRD Requirements vs Actual Implementation
*   **PRD Free User Target:** 1 Hour / Day of Native Browser STT (Free).
*   **PRD Pro User Target:** Unlimited Time, Cloud AI (AssemblyAI).
*   **Actual Codebase Reality:** The `update_user_usage` database RPC currently enforces a strict **1 Hour / Month** limit across ALL users and engines as a safety net. This is a technical debt item that needs refactoring to match the PRD's Daily vs Monthly intentions.

---

## 2. Software Stack Operating Costs (2024 Pricing)

We reviewed the current pricing for our entire stack. Notably, AssemblyAI's streaming pricing is significantly higher than initially projected in the early PRD.

| Software Part | Original PRD Assumption | Current Actual Pricing (2024) |
| :--- | :--- | :--- |
| **Supabase** (Database, Auth, Functions) | $25/month (Pro) | **$25/month** (Pro plan: 100k MAU, 8GB DB, 250GB Egress) |
| **Vercel** (Hosting, Frontend) | $0 (Hobby) or $20 (Pro) | **$20/month** (Pro plan per dev seat for production) |
| **AssemblyAI** (Streaming STT) | $0.15 / hour | **$0.47 / hour** (Universal-Streaming STT) |
| **Stripe** (Payments & Billing) | ~3.0% + $0.30/txn | **3.4% + $0.30/txn** (2.9% + 30¢ Core + 0.5% Billing Starter) |

**Missing Software Identified:**
*   **Email Provider (Resend/SendGrid):** For transactional emails (Welcome, Upgrade, Password Reset). Usually $20/mo after free tier (Resend gives 3k free/mo).
*   **Analytics (PostHog):** Free up to 1M events/mo.

---

## 3. Total Operational Expenditure Projections

Let's calculate the total cost for **50, 100, 250, and 1000 Total Monthly Active Users**. 
*   **Assumption 1:** 2% Conversion Rate (2% of users are Pro, 98% are Free).
*   **Assumption 2:** Pro users consume **4 hours** of AssemblyAI transcription per month. Free users use Native STT (costing $0 to us).
*   **Fixed Costs:** $45/mo ($25 Supabase + $20 Vercel).

| Total Users | Free Users (98%) | Pro Users (2%) | Variable Cost (AssemblyAI @ 4hrs/Pro + Stripe Fees) | Total Monthly Cost (Fixed + Var) | Revenue @ PRD $7.99/mo | Net Profit (Loss) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **50** | 49 | 1 | $1.88 + $0.57 = **$2.45** | **$47.45** | $7.99 | **($39.46)** |
| **100** | 98 | 2 | $3.76 + $1.14 = **$4.90** | **$49.90** | $15.98 | **($33.92)** |
| **250** | 245 | 5 | $9.40 + $2.85 = **$12.25** | **$57.25** | $39.95 | **($17.30)** |
| **1000** | 980 | 20 | $37.60 + $11.40 = **$49.00** | **$94.00** | $159.80 | **+$65.80** |

*Note: The old PRD assumed profitability at 4 Pro users. Due to AssemblyAI's real $0.47/hr streaming cost, we need ~13 Pro users (~650 total app users) just to break even on Fixed Costs at the $7.99 price point.*

---

## 4. Setting the Right Target Price for 75% Profit

To achieve a 75% gross profit margin, revenue must be roughly 4x our costs. 
If an average Pro user uses **4 hours per month**:
*   AssemblyAI Cost: 4 * $0.47 = **$1.88**
*   Stripe Cost: ~3.4% + $0.30
*   Target Price equation: `Price = ($1.88 + $0.30) / (1 - 0.75 - 0.034)`
*   **Optimal Subscription Price:** **$10.09 / month** minimum (Let's round to **$12.99/mo** or **$14.99/mo** to easily cover fixed costs and marketing/CAC buffer).

If a power user uses **10 hours per month**:
*   AssemblyAI Cost: 10 * $0.47 = **$4.70**
*   **Optimal Subscription Price for Power Users:** **$23.14 / month** minimum.

---

## 5. ROI & CAC Analysis (Old vs New Planning)

### Old PRD Planning:
*   **Price:** $7.99/mo
*   **Assumed LTV:** $44 (6 months retention).
*   **Assumed CAC:** N/A (Organic only).
*   **Issue:** Assumed AssemblyAI was $0.15/hr. Gross margin on a power user (10 hrs) would have been profitable. Under real pricing ($0.47/hr * 10hrs = $4.70 cost), the $7.99/mo tier bleeds money if they use it heavily.

### New Strategic Planning:
*   **Recommended Base Price:** **$14.99/month**. (Or $149/year).
*   **Estimated LTV:** ~$85 (assuming 6 months retention at $14.99, minus 5% churn and fees).
*   **Target CAC:** We should aim to acquire a paid user for less than 1/3 of LTV. **Target CAC < $28.00**.
*   **ROI Optimization:** Because streaming AI costs scale linearly with time, we *must* enforce "Unlimited" as a fair-use cap (e.g., "Pro: 'Unlimited' up to 15 hours/month, then fallback to Private Local Engine"). 

---

## 6. Recommendations & Optimizations

1. **Increase Pro Pricing:** Raise the target Pro tier from `$7.99` to **`$14.99/month`**. This is standard for AI productivity tools (e.g., Otter.ai is $16.99/mo). It correctly buffers against AssemblyAI's $0.47/hr streaming costs.
2. **Implement VAD (Voice Activity Detection) Buffering:** Instead of streaming silence to AssemblyAI (which burns $0.47/hr), the frontend microphone should only transmit audio packets when speech is actively detected. This could reduce API costs by 30-50%.
3. **Leapfrog to the Private Engine:** The PRD mentions local Private STT using WebGPU/Transformers.js as a future premium feature. **Prioritize this**. If a Pro User uses their own laptop's GPU to transcribe audio, our Variable Cost drops from $0.47/hr to **$0.00/hr**. It is mathematically the clearest path to achieving 90%+ profit margins.
4. **Fix Database Tier Logic:** Modify `update_user_usage` RPC. Right now, it caps free users to 1 hour *per month*. It must be refactored to allow 1 hour *per day* of purely *Local/Native* STT, while strictly capping Cloud AssemblyAI time.
