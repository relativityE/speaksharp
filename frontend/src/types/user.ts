export interface UserProfile {
  id: string;
  email?: string;
  subscription_status: 'free' | 'pro';
  usage_seconds: number;
  usage_reset_date: string;
  stripe_customer_id?: string;
  subscription_id?: string;
  created_at: string;
  updated_at?: string;
  preferred_mode?: 'native' | 'cloud' | 'on-device';
}
