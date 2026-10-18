import { createHash } from 'node:crypto';

const maximum = 9223372036854775807n;
const generation = (value) => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= maximum;
/** Three bounded exact-target RPCs; failure/uncertainty stops deployment. Never activate or retry. */
export async function invalidateAccountClosureBeforeDeployment({ url, projectId, serviceKey, releaseSha }, fetcher = fetch) {
    let attempted = false;
    const hold = () => ({ status: 'HOLD', mutationOutcome: attempted ? 'unknown' : 'not_attempted', activationAuthorized: false });
    try {
        if (typeof projectId !== 'string' || !/^[a-z0-9-]{1,63}$/.test(projectId)
            || typeof serviceKey !== 'string' || !serviceKey || typeof releaseSha !== 'string' || !/^[a-f0-9]{40}$/.test(releaseSha)) return hold();
        const target = new URL(url);
        if (target.origin !== `https://${projectId}.supabase.co` || target.username || target.password
            || target.pathname !== '/' || target.search || target.hash) return hold();
        url = target.origin;
        async function rpc(name, args, numeric = false) {
            const response = await fetcher(`${url}/rest/v1/rpc/${name}`, { method: 'POST', redirect: 'error',
                headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(args), signal: AbortSignal.timeout(10_000) });
            if (response.status !== 200) { await response.body?.cancel(); throw new Error('RPC refused'); }
            const reader = response.body?.getReader(); if (!reader) throw new Error('RPC unreadable');
            const decoder = new TextDecoder(); let text = ''; let size = 0;
            try {
                while (true) {
                    const chunk = await reader.read(); if (chunk.done) break;
                    size += chunk.value.byteLength;
                    if (size > 256) { await reader.cancel(); throw new Error('RPC unreadable'); }
                    text += decoder.decode(chunk.value, { stream: true });
                }
                text += decoder.decode();
            } finally { reader.releaseLock(); }
            // Preserve SQL bigint decimal bytes, never round them through JSON Number.
            const value = numeric ? text.trim() : JSON.parse(text);
            if (!generation(value)) throw new Error('RPC unreadable');
            return value;
        }
        const before = await rpc('inspect_account_closure_drain_generation', {});
        if (BigInt(before) === maximum) return hold();
        const next = String(BigInt(before) + 1n);
        attempted = true;
        const acknowledged = await rpc('invalidate_account_closure_drain_attestations', {
            p_expected_generation: before, p_reason: 'deployment_changed',
            p_evidence_digest: createHash('sha256').update(JSON.stringify({ projectId, releaseSha })).digest('hex'),
        }, true);
        if (acknowledged !== next || await rpc('inspect_account_closure_drain_generation', {}) !== next) return hold();
        return { status: 'INVALIDATED', generation: next, activationAuthorized: false };
    } catch { return hold(); }
}
