import { useContext } from 'react';
import { TranscriptionContext } from './TranscriptionContext';

export const useTranscriptionContext = () => {
    const context = useContext(TranscriptionContext);
    if (!context) {
        throw new Error('useTranscriptionContext must be used within a TranscriptionProvider');
    }
    return context;
};
