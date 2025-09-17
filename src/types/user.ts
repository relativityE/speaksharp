export interface UserProfile {
  id: string;
  subscription_status: 'free' | 'pro' | 'premium';
  // Add other profile properties here as they are discovered
}
