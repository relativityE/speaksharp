export interface UserProfile {
  id: string;
  email?: string;
  full_name?: string;
  subscription_tier?: 'free' | 'pro';
  subscription_status?: 'free' | 'pro'; // Keeping for backward compatibility if used elsewhere
  preferred_mode?: 'on-device' | 'cloud';
  onboarding_completed?: boolean;
  preferences?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}
