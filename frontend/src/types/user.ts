export interface UserProfile {
  id: string;
  email?: string;
  subscription_status: 'free' | 'pro';
  usage_seconds: number;
  daily_usage_seconds?: number;
  native_usage_seconds?: number;
  cloud_usage_seconds?: number;
  private_usage_seconds?: number;
  usage_reset_date: string;
  last_daily_reset?: string;
  stripe_customer_id?: string;
  subscription_id?: string;
  created_at: string;
  updated_at?: string;
  preferred_mode?: 'native' | 'cloud' | 'private';
}
