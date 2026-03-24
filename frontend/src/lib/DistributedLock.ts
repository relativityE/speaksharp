// src/lib/DistributedLock.ts
import logger from './logger';

export interface LockInfo {
    tabId: string;
    timestamp: number;
    state?: string;
}

/**
 * DISTRIBUTED LOCK (Tab Mutex)
 * ----------------------------
 * A robust mechanism to ensure only one tab/session is active at a time.
 * Supports "Failure Hold" metadata to prevent lock stealing during 
 * critical failure visibility windows.
 */
export class DistributedLock {
    private static readonly LOCK_KEY = 'speaksharp_active_session_lock';
    private static readonly LOCK_TIMEOUT = 5000;
    private static readonly HEARTBEAT_INTERVAL = 2000;

    private tabId: string;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor(tabId?: string) {
        this.tabId = tabId || Math.random().toString(36).substring(2, 15);
    }

    public getTabId(): string {
        return this.tabId;
    }

    /**
     * Attempt to acquire the lock.
     * @param state Optional state metadata (e.g. 'RECORDING', 'FAILED_HOLD')
     */
    public acquire(state?: string): boolean {
        if (typeof localStorage === 'undefined') return true;

        const lock = this.getLock();
        const now = Date.now();

        // 1. Check if lock is held by another active tab
        if (lock && (now - lock.timestamp <= DistributedLock.LOCK_TIMEOUT) && lock.tabId !== this.tabId) {
            // Explicitly reject if the existing lock is in a FAILURE_HOLD state
            if (lock.state === 'FAILED_VISIBLE' || lock.state === 'FAILED') {
                logger.warn({ existingLock: lock }, '[DistributedLock] ❌ Rejection: Existing session is in FAILURE_HOLD');
            } else {
                logger.warn({ existingLock: lock }, '[DistributedLock] ❌ Rejection: Lock held by another tab');
            }
            return false;
        }

        // 2. Write lock with metadata
        const info: LockInfo = {
            tabId: this.tabId,
            timestamp: now,
            state
        };
        localStorage.setItem(DistributedLock.LOCK_KEY, JSON.stringify(info));

        // 3. Start Heartbeat
        this.startHeartbeat(state);
        return true;
    }

    /**
     * Update the state metadata while holding the lock.
     */
    public updateState(state: string): void {
        if (typeof localStorage === 'undefined') return;
        const lock = this.getLock();
        if (lock && lock.tabId === this.tabId) {
            const info: LockInfo = { ...lock, state, timestamp: Date.now() };
            localStorage.setItem(DistributedLock.LOCK_KEY, JSON.stringify(info));
            // Restart heartbeat with new state
            this.startHeartbeat(state);
        }
    }

    public release(): void {
        if (typeof localStorage === 'undefined') return;

        const lock = this.getLock();
        if (lock && lock.tabId === this.tabId) {
            // Lifecycle Guard: Lock Release Invariant
            // Enforce that a lock can only be released if the state is explicitly TERMINATED.
            if (lock.state !== 'TERMINATED') {
                const diagnostic = lock.state || '(unknown)';
                const msg = `Lock release violation: Cannot release from state '${diagnostic}'. Only TERMINATED allowed.`;
                logger.error({ state: diagnostic }, msg);
                
                // We throw in all environments as this represents a critical lifecycle violation 
                // that leads to orphaned locks or session hijacking.
                throw new Error(msg);
            }

            localStorage.removeItem(DistributedLock.LOCK_KEY);
            logger.info('[DistributedLock] 🔓 Lock released');
        }

        this.stopHeartbeat();
    }

    public getLock(): LockInfo | null {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(DistributedLock.LOCK_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    public isHeldByOther(): boolean {
        const lock = this.getLock();
        if (!lock) return false;
        const now = Date.now();
        return (now - lock.timestamp <= DistributedLock.LOCK_TIMEOUT) && lock.tabId !== this.tabId;
    }

    private startHeartbeat(state?: string): void {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            const currentLock = this.getLock();
            if (currentLock && currentLock.tabId === this.tabId) {
                const info: LockInfo = {
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    state: state || currentLock.state
                };
                localStorage.setItem(DistributedLock.LOCK_KEY, JSON.stringify(info));
            } else {
                this.stopHeartbeat();
            }
        }, DistributedLock.HEARTBEAT_INTERVAL);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}
