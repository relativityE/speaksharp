import { useContext } from 'react';
import { AuthContext, AuthContextType } from './AuthContext';

/**
 * Custom hook to access the authentication context.
 *
 * @returns {AuthContextType} The authentication context including session, user, profile, and loading state.
 * @throws {Error} If used outside of an AuthProvider.
 */
export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
