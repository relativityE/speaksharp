export interface UserProfile {
  id: string;
  subscription_status: 'free' | 'pro';
  preferred_mode?: 'on-device' | 'cloud';
  // Add other profile properties here as they are discovered
}
