export interface UserProfile {
  id: string;
  email?: string;
  subscription_status: 'free' | 'pro';
  usage_seconds: number;
  usage_reset_date: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string | null;
  /** Webhook snapshot only: neither field grants paid access on its own. */
  stripe_cancel_at_period_end?: boolean | null;
  stripe_current_period_end?: string | null;
  subscription_id?: string;
  trial_started_at?: string | null;
  trial_expires_at?: string | null;
  created_at: string;
  updated_at?: string;
  preferred_mode?: 'native' | 'cloud' | 'private';
}
