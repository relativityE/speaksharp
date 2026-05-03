/**
 * 🛡️ safeStorage.ts
 * -----------------
 * Prevents SecurityError exceptions in browsers with restricted or 
 * unstable storage origins (common in E2E environments).
 */

export function safeLocalStorageGet(key: string): string | null {
    try {
        return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    } catch (err) {
        console.warn(`[safeStorage] GET failed for ${key}`, err);
        return null;
    }
}

export function safeLocalStorageSet(key: string, value: string): boolean {
    try {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(key, value);
            return true;
        }
        return false;
    } catch (err) {
        console.warn(`[safeStorage] SET failed for ${key}`, err);
        return false;
    }
}

export function safeLocalStorageRemove(key: string): boolean {
    try {
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(key);
            return true;
        }
        return false;
    } catch (err) {
        console.warn(`[safeStorage] REMOVE failed for ${key}`, err);
        return false;
    }
}
