import { useContext } from 'react';
import { SessionContext, SessionContextValue } from './SessionContext';

export const useSession = (): SessionContextValue => {
    const context = useContext(SessionContext);
    if (context === undefined) {
        throw new Error('useSession must be used within a SessionProvider');
    }
    return context;
};
