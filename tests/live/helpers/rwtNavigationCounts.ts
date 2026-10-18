/** Read-only navigation cannot prove no writes from an absent or malformed count. */
export const knownSessionCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function navigationWritesVerdict(before: unknown, after: unknown): { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string } {
    if (!knownSessionCount(before) || !knownSessionCount(after)) {
        return { status: 'HOLD', detail: 'session count is unavailable or invalid; navigation writes are unverified' };
    }
    return before === after
        ? { status: 'PASS', detail: 'navigation alone created no session' }
        : { status: 'FAIL', detail: 'session count changed during navigation' };
}
