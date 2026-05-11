export interface UserProfile {
  id: string;
  email?: string;
  subscription_status: 'free' | 'pro';
  usage_seconds: number;
  usage_reset_date: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string | null;
  subscription_id?: string;
  promo_expires_at?: string | null;
  created_at: string;
  updated_at?: string;
  preferred_mode?: 'native' | 'cloud' | 'private';
}
