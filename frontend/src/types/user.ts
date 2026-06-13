export interface UserProfile {
  id: string;
  email?: string;
  subscription_status: 'free' | 'basic' | 'pro';
  usage_seconds: number;
  usage_reset_date: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string | null;
  subscription_id?: string;
  trial_started_at?: string | null;
  trial_expires_at?: string | null;
  private_sample_limit_seconds?: number;
  private_sample_seconds_used?: number;
  private_sample_started_at?: string | null;
  private_sample_completed_at?: string | null;
  private_sample_session_id?: string | null;
  created_at: string;
  updated_at?: string;
  preferred_mode?: 'native' | 'cloud' | 'private';
}
