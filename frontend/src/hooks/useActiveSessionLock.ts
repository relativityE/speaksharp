import { useState, useEffect, useCallback, useRef } from 'react';
import { TestFlags } from '../config/TestFlags';

const LOCK_KEY = 'speaksharp_active_session_lock';
const HEARTBEAT_INTERVAL = 2000;
const LOCK_TIMEOUT = 5000;

interface SessionLockInfo {
    tabId: string;
    timestamp: number;
}

export const useActiveSessionLock = () => {
    const [isLockHeldByOther, setIsLockHeldByOther] = useState(false);
    const tabId = useRef(Math.random().toString(36).substring(2, 15)).current;
    const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);

    const getLock = useCallback((): SessionLockInfo | null => {
        const raw = localStorage.getItem(LOCK_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }, []);

    const checkLockStatus = useCallback(() => {
        const lock = getLock();
        if (!lock) {
            setIsLockHeldByOther(false);
            return;
        }

        const now = Date.now();
        const isStale = now - lock.timestamp > LOCK_TIMEOUT;

        if (isStale) {
            setIsLockHeldByOther(false);
            return;
        }

        setIsLockHeldByOther(lock.tabId !== tabId);
    }, [getLock, tabId]);

    const acquireLock = useCallback(() => {
        const lock = getLock();
        const now = Date.now();
        if (lock && (now - lock.timestamp <= LOCK_TIMEOUT) && lock.tabId !== tabId) {
            setIsLockHeldByOther(true);
            return false;
        }

        const info: SessionLockInfo = {
            tabId,
            timestamp: now
        };
        localStorage.setItem(LOCK_KEY, JSON.stringify(info));
        setIsLockHeldByOther(false);

        // Start heartbeat
        if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = setInterval(() => {
            const currentLock = getLock();
            if (currentLock && currentLock.tabId === tabId) {
                localStorage.setItem(LOCK_KEY, JSON.stringify({
                    tabId,
                    timestamp: Date.now()
                }));
            }
        }, HEARTBEAT_INTERVAL);

        return true;
    }, [getLock, tabId]);

    const releaseLock = useCallback(() => {
        const lock = getLock();
        if (lock && lock.tabId === tabId) {
            localStorage.removeItem(LOCK_KEY);
        }
        if (heartbeatTimer.current) {
            clearInterval(heartbeatTimer.current);
            heartbeatTimer.current = null;
        }
        setIsLockHeldByOther(false);
        // Signal cleanup for E2E (Strict Zero)
        if (TestFlags.IS_E2E) {
            (window as unknown as { __lockAcquired__?: boolean }).__lockAcquired__ = false;
        }
    }, [getLock, tabId]);

    useEffect(() => {
        checkLockStatus();

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === LOCK_KEY) {
                checkLockStatus();
            }
        };

        window.addEventListener('storage', handleStorageChange);

        // Polling fallback to detect internal state changes or stale locks
        const pollTimer = setInterval(checkLockStatus, 3000);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            clearInterval(pollTimer);
            if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
        };
    }, [checkLockStatus]);

    return {
        isLockHeldByOther,
        acquireLock,
        releaseLock,
        tabId
    };
};
