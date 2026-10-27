import { createAccountClosureAttestationService } from './accountClosureAttestationService.mjs';
import { setTimeout, clearTimeout } from 'node:timers';

const operations = new Set(['record_account_closure_drain_attestation', 'invalidate_account_closure_drain_attestations']);
const maximum = 9223372036854775807n;
async function boundedBody(response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('unreadable response');
    const decoder = new TextDecoder(); let bytes = 0; let text = '';
    try {
        while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 16_384) { await reader.cancel(); throw new Error('oversize response'); }
            text += decoder.decode(chunk.value, { stream: true });
        }
        return text + decoder.decode();
    } finally { reader.releaseLock(); }
}

/**
 * Concrete private registration transport, not a live-fact collector. The trusted
 * collector must acquire current facts independently and honor the supplied abort
 * signal. It receives the fixed target, never this transport's service credential.
 * Matching supplied JSON does not establish worker termination or live truth.
 * One mutation per invocation; unknown delivery is HOLD, never an automatic retry.
 */
export function createAccountClosureAttestationTransport(configuration, collectCurrentFacts, fetcher = fetch) {
    const { url, projectId, environment, serviceKey } = configuration ?? {};
    if (typeof projectId !== 'string' || !/^[a-z0-9-]{1,63}$/.test(projectId)
        || !['production', 'disposable'].includes(environment) || typeof serviceKey !== 'string' || !serviceKey.trim()
        || typeof collectCurrentFacts !== 'function' || typeof fetcher !== 'function') throw new Error('invalid fixed target');
    const parsed = new URL(url);
    if (parsed.origin !== `https://${projectId}.supabase.co` || parsed.pathname !== '/'
        || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid fixed target');
    const target = Object.freeze({ url: parsed.origin, projectId, environment });
    return createAccountClosureAttestationService({
        async getCurrentContext() {
            const controller = new AbortController(); let timer;
            const aborted = new Promise((_, reject) => { timer = setTimeout(() => {
                controller.abort(); reject(new Error('facts unavailable'));
            }, 10_000); });
            let facts;
            try { facts = structuredClone(await Promise.race([collectCurrentFacts(target, controller.signal), aborted])); }
            finally { clearTimeout(timer); }
            if (facts?.context?.target?.projectId !== projectId || facts.context.target.environment !== environment) {
                throw new Error('current facts address a different target');
            }
            return facts;
        },
        async rpc(name, args) {
            if (!operations.has(name)) throw new Error('unsupported private operation');
            const body = JSON.stringify(args);
            if (new TextEncoder().encode(body).byteLength > 1_048_576) throw new Error('oversize request');
            const response = await fetcher(`${target.url}/rest/v1/rpc/${name}`, {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), body,
                headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
            });
            const text = await boundedBody(response);
            if (response.status !== 200) {
                const error = JSON.parse(text);
                // Return only known database refusal codes, never raw provider text,
                // request records, credentials or an HTML/proxy error page.
                if (!['P0001', '23505', '42501', '22023'].includes(error?.code)) throw new Error('RPC outcome unknown');
                return { data: null, error: { code: error.code, message: error.message === 'attestation identity conflict'
                    ? 'attestation identity conflict' : 'statement rejected' } };
            }
            if (name === 'invalidate_account_closure_drain_attestations') {
                const value = text.trim();
                if (!/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > maximum) throw new Error('invalid generation');
                return { data: value, error: null }; // Preserve SQL bigint decimal bytes.
            }
            return { data: JSON.parse(text), error: null };
        },
    });
}
