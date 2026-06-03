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
/**
 * Safely read + JSON.parse a localStorage value. Corrupted/legacy values (invalid
 * JSON, or values failing the optional `validate` guard) are removed and the
 * `fallback` is returned, so a stale stored value can never throw — especially in
 * a render-path `useState` initializer where a throw white-screens the component
 * tree. Never throws.
 */
export function safeLocalStorageGetJSON<T>(
    key: string,
    fallback: T,
    validate?: (value: unknown) => boolean,
): T {
    const raw = safeLocalStorageGet(key);
    if (raw == null) return fallback;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (validate && !validate(parsed)) {
            safeLocalStorageRemove(key);
            return fallback;
        }
        return parsed as T;
    } catch (err) {
        console.warn(`[safeStorage] Corrupted JSON for ${key}; clearing`, err);
        safeLocalStorageRemove(key);
        return fallback;
    }
}

export function clearAll() {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).TEST_MODE) {
        window.localStorage.clear();
    }
}
