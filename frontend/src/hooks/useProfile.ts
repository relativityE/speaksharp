import { useContext } from 'react';
import ProfileContext from '../contexts/ProfileContext';
import { UserProfile } from '../types/user';

/**
 * Convenience hook that provides the current user's profile from context.
 * Guarantees that the profile is non-null when used within a ProfileGuard.
 */
export const useProfile = (): UserProfile => {
    const context = useContext(ProfileContext);
    if (context === undefined) {
        throw new Error('useProfile must be used within a ProfileProvider (via ProfileGuard)');
    }
    return context.profile;
};
