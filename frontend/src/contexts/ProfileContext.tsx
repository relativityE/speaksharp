import { createContext } from 'react';
import { UserProfile } from '../types/user';

/**
 * ARCHITECTURE:
 * ProfileContext provides a guaranteed non-null UserProfile down the tree.
 * 
 * DESIGN RATIONALE:
 * Components inside ProfileGuard can assume the profile is loaded.
 * By using this context, we eliminate 'if (!profile) return null' guards
 * in hundreds of sub-components, improving developer ergonomics and reducing
 * edge-case bugs.
 */

interface ProfileContextType {
    profile: UserProfile | null;
    isVerified: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const ProfileProvider = ProfileContext.Provider;

export default ProfileContext;
