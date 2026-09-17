// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PAYLOAD_TRIPWIRE } from '../../scripts/human-test/payloadTripwire.mjs';
import {
    canaryPathContainsEncodedAudio,
    canaryQueryContainsEncodedAudio,
    classifyCanaryStartResponse,
    classifyCanaryUsageEntitlement,
    judgeCanaryEgress,
    judgeDurableSession,
    judgeSessionAttributionAuthority,
    sanitizeCanaryPayloadUrl,
    sanitizeCanaryDenialCategory,
    verdictCategory,
    verdictUrl,
} from '../canary/canaryRuntimeContract';

describe('production canary authoritative start contract', () => {
    it('sanitizes every advisory entitlement denial before emitting it to CI', () => {
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: false, error: 'trial_expired',
        }, 'active-trial')).toEqual({ ok: false, category: 'trial_expired' });
        for (const error of [
            'customer@example.test',
            'database said: permission denied',
            'punctuation-bearing-message!',
        ]) {
            expect(classifyCanaryUsageEntitlement({
                subscription_status: 'pro', is_pro: true, can_start: false, error,
            }, 'active-trial')).toEqual({ ok: false, category: 'unknown' });
        }
    });

    it('fails closed on non-Pro advisory entitlement fields', () => {
        expect(classifyCanaryUsageEntitlement({ subscription_status: 'free', is_pro: false, can_start: true }, 'active-trial'))
            .toEqual({ ok: false, category: 'subscription_status' });
        expect(classifyCanaryUsageEntitlement({ subscription_status: 'pro', is_pro: false, can_start: true }, 'active-trial'))
            .toEqual({ ok: false, category: 'is_pro' });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: true, trial_expires_at: '2026-09-01T00:00:00Z',
        }, 'active-trial'))
            .toEqual({ ok: true });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: false, trial_expires_at: null,
        }, 'paid-continuation')).toEqual({ ok: true });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: false, trial_expires_at: null,
        }, 'active-trial')).toEqual({ ok: false, category: 'trial_inactive' });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: true, trial_expires_at: '2026-09-01T00:00:00Z',
        }, 'paid-continuation')).toEqual({ ok: false, category: 'paid_marked_trial' });
    });

    it('surfaces an exact sanitized server denial before UI assertions', () => {
        expect(classifyCanaryStartResponse(200, {
            error: 'trial_expired',
            new_session: null,
            usage_exceeded: true,
        })).toEqual({ ok: false, category: 'trial_expired' });
    });

    it('never reflects arbitrary response text and fails closed on malformed/HTTP responses', () => {
        expect(sanitizeCanaryDenialCategory('customer email: secret@example.test')).toBe('unknown');
        expect(classifyCanaryStartResponse(503, null)).toEqual({ ok: false, category: 'rpc_http_503' });
        expect(classifyCanaryStartResponse(200, null)).toEqual({ ok: false, category: 'rpc_invalid_response' });
        expect(classifyCanaryStartResponse(200, { usage_exceeded: false, new_session: null }))
            .toEqual({ ok: false, category: 'rpc_missing_session' });
    });

    it('accepts only a successful response with a durable session identity', () => {
        expect(classifyCanaryStartResponse(200, {
            usage_exceeded: false,
            new_session: { id: 'session-1' },
        })).toEqual({ ok: true, sessionId: 'session-1' });
    });

    it('locks runtime RECORDING, during-state, exact Private authority, and current stop control', () => {
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');
        expect(smoke).toContain('CANARY_START_DENIED:');
        expect(smoke).toContain('CANARY_ENTITLEMENT_DENIED:');
        expect(smoke).toContain('classifyCanaryUsageEntitlement(u, CANARY_USER.lane)');
        expect(smoke).toContain("if (CANARY_USER.lane === 'paid-continuation')");
        expect(smoke).toContain("page.getByTestId(TEST_IDS.PRO_BADGE)).toHaveCount(0)");
        expect(smoke).toContain('html[data-runtime-state="RECORDING"][data-stt-resolved-mode="private"]');
        expect(smoke).toContain('[data-testid="session-shell"][data-session-state="during"]');
        expect(smoke).toContain('body[data-stt-policy="private"]');
        expect(smoke).toContain('[data-testid="live-session-header"][data-engine="private"][data-recording="true"]');
        expect(smoke).toContain("getByTestId('recorder-stop')");
        expect(smoke).not.toContain('data-engine="browser"');
        expect(smoke).not.toContain('data-engine="cloud"');
        expect(smoke).not.toContain('data-engine="native"');
    });
});

describe('#1258 — the canary proves THIS take saved, and the old oracle cannot return', () => {
    const row = (over = {}) => ({
        id: 'take-under-test', user_id: 'u1', total_words: 42, duration: 5, created_at: 'now', ...over,
    });
    const durablePass = { ok: true, totalWords: 42 };

    it('CASUALTY: an empty session list FAILS — it is the signature of a silent save failure', () => {
        // The replaced oracle ran its only save assertion inside `if (sessions.length > 0)`, so the
        // exact failure it existed to catch skipped it and the spec logged "Smoke test passed".
        expect(judgeDurableSession([], 'take-under-test'))
            .toEqual({ ok: false, category: 'take_did_not_save' });
    });

    it('CASUALTY: `sessions[0]` behaviour cannot return — a newer OTHER take does not satisfy this take', () => {
        // The replaced oracle validated sessions[0], the newest row the account has. On a re-run that
        // is the PREVIOUS take, so a take that never saved passed on its predecessor's row.
        const list = [row({ id: 'some-newer-take' }), row({ id: 'take-under-test' })];
        expect(judgeDurableSession(list, 'take-under-test')).toEqual(durablePass);
        expect(judgeDurableSession([row({ id: 'some-newer-take' })], 'take-under-test'))
            .toEqual({ ok: false, category: 'take_session_id_absent' });
    });

    it('requires EXACTLY one durable row for the take', () => {
        expect(judgeDurableSession([row(), row()], 'take-under-test'))
            .toEqual({ ok: false, category: 'take_session_id_duplicated' });
    });

    it('fails a saved row that captured no words', () => {
        expect(judgeDurableSession([row({ total_words: 0 })], 'take-under-test'))
            .toEqual({ ok: false, category: 'saved_zero_words' });
    });

    it('fails closed on a malformed list or a missing schema field', () => {
        expect(judgeDurableSession(null, 'take-under-test'))
            .toEqual({ ok: false, category: 'session_list_not_an_array' });
        expect(judgeDurableSession([row({ duration: undefined })], 'take-under-test'))
            .toEqual({ ok: false, category: 'schema_missing_duration' });
    });

    it('POSITIVE CONTROL: a single well-formed row for this take passes', () => {
        expect(judgeDurableSession([row()], 'take-under-test')).toEqual(durablePass);
    });

    const authorityRow = (over = {}) => ({
        session_id: 'take-under-test', user_id: 'u1', authority_version: 'attrib_v1',
        engine_class: 'private', engine: 'private', engine_version: 'private_v2:whisper-base.en',
        model_id: 'whisper-base.en', provider: 'transformers-js', attested_at: 'now', ...over,
    });
    const authorityPass = {
        ok: true, authorityVersion: 'attrib_v1', engineClass: 'private',
        engineVersion: 'private_v2:whisper-base.en', modelId: 'whisper-base.en', provider: 'transformers-js',
    };

    it('CASUALTY: a client-facing session tuple cannot substitute for server-owned attribution authority', () => {
        expect(judgeSessionAttributionAuthority([], 'take-under-test'))
            .toEqual({ ok: false, category: 'candidate_authority_absent' });
        expect(judgeSessionAttributionAuthority([authorityRow({ session_id: 'other-take' })], 'take-under-test'))
            .toEqual({ ok: false, category: 'candidate_authority_absent' });
    });

    it('fails closed on duplicate, malformed, stale-version, non-Private, or non-transformers authority', () => {
        expect(judgeSessionAttributionAuthority([authorityRow(), authorityRow()], 'take-under-test'))
            .toEqual({ ok: false, category: 'candidate_authority_duplicated' });
        expect(judgeSessionAttributionAuthority([authorityRow({ model_id: null })], 'take-under-test'))
            .toEqual({ ok: false, category: 'authority_schema_missing_model_id' });
        expect(judgeSessionAttributionAuthority([authorityRow({ authority_version: 'attrib_v0' })], 'take-under-test'))
            .toEqual({ ok: false, category: 'candidate_authority_version_invalid' });
        expect(judgeSessionAttributionAuthority([authorityRow({ engine_class: 'browser' })], 'take-under-test'))
            .toEqual({ ok: false, category: 'candidate_authority_not_private' });
        expect(judgeSessionAttributionAuthority([authorityRow({ provider: 'web-speech' })], 'take-under-test'))
            .toEqual({ ok: false, category: 'candidate_authority_provider_invalid' });
    });

    it('POSITIVE CONTROL: exactly one server-owned attrib_v1 Private row for this take passes', () => {
        expect(judgeSessionAttributionAuthority([authorityRow()], 'take-under-test')).toEqual(authorityPass);
    });

    it('binds candidate proof to the persisted tuple and the exact checked-in selector', () => {
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');
        expect(smoke).toContain('session_attribution_authority');
        expect(smoke).toContain('judgeSessionAttributionAuthority(authorityRows, boundSessionId)');
        expect(smoke).toContain('candidateFromPersistedTuple(engineVersion, modelId)');
        expect(smoke).toContain("readFileSync('frontend/src/config/private-stt.config.json'");
        expect(smoke).toContain('CANARY_CANDIDATE_DIVERGENCE');
        expect(smoke).not.toContain('durable.attributionStatus');
        expect(smoke).not.toContain('__SS_ACTIVE_CANDIDATE__');
    });

    it('pins the exactly-one start RPC guard in the deployed journey', () => {
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');
        expect(smoke).toContain("createSessionRpcCount += 1");
        expect(smoke).toContain("CANARY_DUPLICATE_SESSION_CREATE");
        expect(smoke).toContain("toBe(1)");
    });

    it('requires an explicit Supabase origin instead of silently trusting the app origin', () => {
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');
        expect(smoke).toContain('CANARY_CONFIG_INVALID: Supabase URL is required for exact-origin policy');
        expect(smoke).not.toContain('process.env.SUPABASE_URL ?? appOrigin');
    });

    it('wires the scheduled canary to the same Supabase, PostHog, and Sentry authorities as Production', () => {
        const workflow = readFileSync('.github/workflows/canary.yml', 'utf8');
        const activeTrial = workflow.split('- name: Run Smoke Test (active-trial product path)')[1]
            ?.split('- name:')[0] ?? '';
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');

        expect(activeTrial).toContain('SUPABASE_URL: ${{ vars.SUPABASE_URL }}');
        expect(activeTrial).toContain('VITE_POSTHOG_HOST: ${{ vars.POSTHOG_INGEST_HOST }}');
        expect(activeTrial).toContain('SENTRY_DSN: ${{ vars.SENTRY_DSN }}');
        expect(smoke).toContain('process.env.VITE_POSTHOG_HOST');
        expect(smoke).toContain('process.env.SENTRY_DSN');
        expect(smoke).not.toContain('VITE_PUBLIC_POSTHOG_HOST');
    });

    it('requires the shared payload tripwire in both the main document and Private-STT worker', () => {
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');
        expect(smoke).toContain("from '../../scripts/human-test/payloadTripwire.mjs'");
        expect(smoke).toContain('page.addInitScript({ content: PAYLOAD_TRIPWIRE })');
        expect(smoke).toContain('worker.evaluate(PAYLOAD_TRIPWIRE)');
        expect(smoke).toContain('CANARY_PAYLOAD_OBSERVER_GAP');
        expect(smoke).toContain('CANARY_AUDIO_EGRESS');
        expect(smoke).toContain('auditPayloads(payloadRecords');
        expect(smoke).toContain("page.getByTestId('session-verdict')");
        expect(smoke).toContain("page.getByTestId('verdict-see-all').click()");
        expect(smoke.indexOf("page.getByTestId('session-verdict')"))
            .toBeLessThan(smoke.indexOf('const payloadFindings = auditPayloads(payloadRecords'));
        expect(smoke.indexOf('const payloadFindings = auditPayloads(payloadRecords'))
            .toBeLessThan(smoke.indexOf("page.getByTestId('verdict-see-all').click()"));
        expect(smoke).not.toContain('page.waitForTimeout(100)');
        expect(smoke).toContain('__SS_TRIPWIRE_DRAIN__');
        expect(PAYLOAD_TRIPWIRE).toContain("type: 'worker_ready'");
        expect(PAYLOAD_TRIPWIRE).toContain("type: 'counter_offer'");
        expect(PAYLOAD_TRIPWIRE).toContain('Atomics.add(relayCounter, 0, 1) + 1');
        expect(PAYLOAD_TRIPWIRE).not.toContain("type: 'drain_request'");
        expect(PAYLOAD_TRIPWIRE).not.toContain('payload relay did not become quiet');
        expect(PAYLOAD_TRIPWIRE).toContain("type: 'record', workerId, sequence, record");
        expect(PAYLOAD_TRIPWIRE).toContain("__ssSource: 'worker'");
    });

    it('pins the durable session read to the projected GET rather than the bodyless count HEAD', () => {
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');
        const durableWait = smoke.split('const sessionResponsePromise = page.waitForResponse')[1]
            ?.split('await page.reload()')[0] ?? '';
        expect(durableWait).toContain("res.request().method() !== 'GET'");
        expect(durableWait).toContain("url.pathname.endsWith('/rest/v1/sessions')");
        expect(durableWait).toContain("projection.includes('total_words')");
        expect(durableWait).toContain("projection.includes('duration')");
    });

    it('CASUALTY: worker termination stays synchronous while drain waits for the streamed binding', async () => {
        type Listener = (event: { data: unknown }) => void;
        class FakeBroadcastChannel {
            static channels = new Set<FakeBroadcastChannel>();
            listeners = new Set<Listener>();
            constructor(name: string) { void name; FakeBroadcastChannel.channels.add(this); }
            addEventListener(_type: string, listener: Listener) { this.listeners.add(listener); }
            postMessage(data: unknown) {
                queueMicrotask(() => {
                    for (const channel of FakeBroadcastChannel.channels) {
                        if (channel === this) continue;
                        for (const listener of channel.listeners) listener({ data });
                    }
                });
            }
        }
        let terminateCalls = 0;
        class FakeWorker {
            terminate() { terminateCalls += 1; }
        }
        type DrainResult = { workers: number; received: number; acknowledged: number };
        type TripwireGlobal = typeof globalThis & {
            window?: unknown;
            document?: { documentElement?: { getAttribute?: (name: string) => string | null } };
            BroadcastChannel?: typeof FakeBroadcastChannel;
            Worker?: typeof FakeWorker;
            __SS_TRIPWIRE__?: unknown[];
            __SS_TRIPWIRE_EMIT__?: (record: Record<string, unknown>) => Promise<void>;
            __SS_TRIPWIRE_DRAIN__?: (expected: number) => Promise<DrainResult>;
        };
        const scope = globalThis as TripwireGlobal;
        const originalWindow = scope.window;
        const originalDocument = scope.document;
        const originalBroadcastChannel = scope.BroadcastChannel;
        const originalWorker = scope.Worker;
        let resolveBinding = () => {};
        const bindingPromise = new Promise<void>((resolve) => { resolveBinding = resolve; });

        try {
            delete scope.__SS_TRIPWIRE__;
            scope.window = scope;
            scope.document = { documentElement: { getAttribute: () => 'STOPPING' } };
            scope.BroadcastChannel = FakeBroadcastChannel;
            scope.Worker = FakeWorker;
            scope.__SS_TRIPWIRE_EMIT__ = vi.fn(() => bindingPromise);
            new Function(PAYLOAD_TRIPWIRE)();

            const workerRelay = new FakeBroadcastChannel('__speaksharp_canary_payload_v1__');
            let sharedCounter: Int32Array | null = null;
            workerRelay.addEventListener('message', ({ data }) => {
                const message = data as {
                    type?: string; workerId?: string; counter?: SharedArrayBuffer;
                };
                if (message.type !== 'counter_offer' || message.workerId !== 'worker-1' || !message.counter) return;
                sharedCounter = new Int32Array(message.counter);
                workerRelay.postMessage({
                    marker: '__speaksharp_canary_payload_v1__',
                    type: 'counter_ready',
                    workerId: 'worker-1',
                });
            });
            workerRelay.postMessage({
                marker: '__speaksharp_canary_payload_v1__',
                type: 'worker_ready',
                workerId: 'worker-1',
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(sharedCounter).not.toBeNull();
            const sequence = Atomics.add(sharedCounter as Int32Array, 0, 1) + 1;
            workerRelay.postMessage({
                marker: '__speaksharp_canary_payload_v1__',
                type: 'record',
                workerId: 'worker-1',
                sequence,
                record: { kind: 'audio', bytes: 512 },
            });

            new scope.Worker().terminate();
            expect(terminateCalls).toBe(1);
            const drainPromise = scope.__SS_TRIPWIRE_DRAIN__?.(1);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(terminateCalls).toBe(1);

            resolveBinding();
            await expect(drainPromise).resolves.toMatchObject({ workers: 1, received: 1, acknowledged: 1 });
            expect(terminateCalls).toBe(1);
            expect(scope.__SS_TRIPWIRE_EMIT__).toHaveBeenCalledWith(expect.objectContaining({
                kind: 'audio', bytes: 512, __ssSource: 'worker',
            }));
        } finally {
            if (originalWindow === undefined) delete scope.window;
            else scope.window = originalWindow;
            if (originalDocument === undefined) delete scope.document;
            else scope.document = originalDocument;
            if (originalBroadcastChannel === undefined) delete scope.BroadcastChannel;
            else scope.BroadcastChannel = originalBroadcastChannel;
            if (originalWorker === undefined) delete scope.Worker;
            else scope.Worker = originalWorker;
            delete scope.__SS_TRIPWIRE__;
            delete scope.__SS_TRIPWIRE_EMIT__;
            delete scope.__SS_TRIPWIRE_DRAIN__;
            FakeBroadcastChannel.channels.clear();
        }
    });

    it('CASUALTY: Request metadata is opaque before the observer binding serializes it', async () => {
        type TripwireGlobal = typeof globalThis & {
            __SS_TRIPWIRE__?: unknown[];
            __SS_TRIPWIRE_EMIT__?: (record: Record<string, unknown>) => void;
            document?: { documentElement?: { getAttribute?: (name: string) => string | null } };
        };
        const scope = globalThis as TripwireGlobal;
        const originalFetch = scope.fetch;
        const originalDocument = scope.document;
        const records: Record<string, unknown>[] = [];

        try {
            delete scope.__SS_TRIPWIRE__;
            scope.__SS_TRIPWIRE_EMIT__ = (record) => { records.push(record); };
            scope.document = { documentElement: { getAttribute: () => 'STOPPING' } };
            scope.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;

            // The installed source is exactly what Playwright injects before app code.
            new Function(PAYLOAD_TRIPWIRE)();
            await scope.fetch(new Request('https://example.test/save', { method: 'POST', body: 'content' }));

            expect(records).toHaveLength(1);
            expect(records[0]).toMatchObject({ kind: 'opaque_stream', bytes: -1 });
        } finally {
            scope.fetch = originalFetch;
            if (originalDocument === undefined) delete scope.document;
            else scope.document = originalDocument;
            delete scope.__SS_TRIPWIRE__;
            delete scope.__SS_TRIPWIRE_EMIT__;
        }
    });

    it('CASUALTY: base64 and numeric JSON PCM are classified before approved-origin policy can hide them', async () => {
        type TripwireGlobal = typeof globalThis & {
            __SS_TRIPWIRE__?: unknown[];
            __SS_TRIPWIRE_EMIT__?: (record: Record<string, unknown>) => void;
            document?: { documentElement?: { getAttribute?: (name: string) => string | null } };
        };
        const scope = globalThis as TripwireGlobal;
        const originalFetch = scope.fetch;
        const originalDocument = scope.document;
        const records: Record<string, unknown>[] = [];

        try {
            delete scope.__SS_TRIPWIRE__;
            scope.__SS_TRIPWIRE_EMIT__ = (record) => { records.push(record); };
            scope.document = { documentElement: { getAttribute: () => 'RECORDING' } };
            scope.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;

            new Function(PAYLOAD_TRIPWIRE)();
            await scope.fetch('https://speaksharp-public.vercel.app/api/upload', {
                method: 'POST', body: 'A'.repeat(512),
            });
            await scope.fetch('https://abcproject.supabase.co/functions/v1/proxy', {
                method: 'POST', body: JSON.stringify(Array.from({ length: 64 }, (_, index) => index / 64)),
            });
            await scope.fetch('https://speaksharp-public.vercel.app/api/proxy', {
                method: 'POST', body: JSON.stringify({ audio: 'B'.repeat(512) }),
            });
            await scope.fetch('https://speaksharp-public.vercel.app/api/proxy', {
                method: 'POST', body: JSON.stringify({ audio: '-_'.repeat(129) }),
            });
            await scope.fetch('https://speaksharp-public.vercel.app/api/proxy', {
                method: 'POST', body: JSON.stringify({ audio: ['-_'.repeat(129)] }),
            });
            await scope.fetch('https://eu.posthog.com/e/', {
                method: 'POST', body: JSON.stringify({ properties: { samples: Array.from({ length: 64 }, (_, index) => index / 64) } }),
            });
            await scope.fetch('https://eu.posthog.com/e/', {
                method: 'POST', body: JSON.stringify({ event: 'session_saved', distinct_id: 'canary' }),
            });
            await scope.fetch('https://speaksharp-public.vercel.app/api/proxy', {
                method: 'POST', body: new URLSearchParams({ audio: 'C'.repeat(512) }),
            });
            await scope.fetch('https://eu.posthog.com/e/', {
                method: 'POST', body: new URLSearchParams({ event: 'session_saved', distinct_id: 'canary' }),
            });
            const labeledTextForm = new FormData();
            labeledTextForm.append('audio', 'D'.repeat(511));
            await scope.fetch('https://speaksharp-public.vercel.app/api/proxy', {
                method: 'POST', body: labeledTextForm,
            });
            const labeledBlobForm = new FormData();
            labeledBlobForm.append('audio', new Blob(['opaque bytes'], { type: 'application/octet-stream' }));
            await scope.fetch('https://abcproject.supabase.co/functions/v1/proxy', {
                method: 'POST', body: labeledBlobForm,
            });

            expect(records.map((record) => record.kind)).toEqual([
                'encoded_audio', 'encoded_audio', 'encoded_audio', 'encoded_audio', 'encoded_audio',
                'encoded_audio', 'text', 'encoded_audio', 'form', 'audio', 'audio',
            ]);
            expect(JSON.stringify(records)).not.toContain('AAAA');
            expect(JSON.stringify(records)).not.toContain('BBBB');
            expect(JSON.stringify(records)).not.toContain('CCCC');
            expect(JSON.stringify(records)).not.toContain('DDDD');
            expect(JSON.stringify(records)).not.toContain('-_');
        } finally {
            scope.fetch = originalFetch;
            if (originalDocument === undefined) delete scope.document;
            else scope.document = originalDocument;
            delete scope.__SS_TRIPWIRE__;
            delete scope.__SS_TRIPWIRE_EMIT__;
        }
    });


    it('CASUALTY: native submit and requestSubmit cannot bypass audio-shaped FormData inspection', () => {
        let submitCalls = 0;
        let requestSubmitCalls = 0;
        let submitListener: ((event: { target: unknown; submitter?: unknown }) => void) | null = null;
        class FakeHTMLFormElement {
            action = 'https://speaksharp-public.vercel.app/api/upload';
            method = 'post';
            enctype = 'multipart/form-data';
            rows: Array<[string, string]> = [['audio', '-_'.repeat(129)]];
            submit() { submitCalls += 1; }
            requestSubmit(submitter?: unknown) {
                requestSubmitCalls += 1;
                if (submitListener) submitListener({ target: this, submitter });
            }
        }
        class FakeFormData {
            private readonly rows: Array<[string, string]>;
            constructor(form?: FakeHTMLFormElement) { this.rows = form?.rows ?? []; }
            entries() { return this.rows[Symbol.iterator](); }
        }
        type TripwireGlobal = typeof globalThis & {
            __SS_TRIPWIRE__?: unknown[];
            __SS_TRIPWIRE_EMIT__?: (record: Record<string, unknown>) => void;
        };
        const scope = globalThis as TripwireGlobal;
        const originalForm = Object.getOwnPropertyDescriptor(globalThis, 'HTMLFormElement');
        const originalFormData = Object.getOwnPropertyDescriptor(globalThis, 'FormData');
        const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
        const records: Record<string, unknown>[] = [];
        const restore = (name: string, descriptor: PropertyDescriptor | undefined) => {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete (globalThis as unknown as Record<string, unknown>)[name];
        };

        try {
            delete scope.__SS_TRIPWIRE__;
            scope.__SS_TRIPWIRE_EMIT__ = (record) => { records.push(record); };
            Object.defineProperty(globalThis, 'HTMLFormElement', {
                configurable: true, writable: true, value: FakeHTMLFormElement,
            });
            Object.defineProperty(globalThis, 'FormData', {
                configurable: true, writable: true, value: FakeFormData,
            });
            Object.defineProperty(globalThis, 'document', {
                configurable: true,
                writable: true,
                value: {
                    location: 'https://speaksharp-public.vercel.app/session',
                    documentElement: { getAttribute: () => 'RECORDING' },
                    addEventListener: (
                        type: string,
                        listener: (event: { target: unknown; submitter?: unknown }) => void,
                    ) => { if (type === 'submit') submitListener = listener; },
                },
            });

            new Function(PAYLOAD_TRIPWIRE)();
            const form = new FakeHTMLFormElement();
            form.submit();
            form.requestSubmit({
                formAction: 'https://abcproject.supabase.co/functions/v1/proxy',
                formMethod: 'post',
                formEnctype: 'multipart/form-data',
            });
            if (!submitListener) throw new Error('submit listener was not installed');
            submitListener({ target: form });

            expect(submitCalls).toBe(1);
            expect(requestSubmitCalls).toBe(1);
            expect(records.map((record) => record.kind)).toEqual(['audio', 'audio', 'audio']);
            expect(records.map((record) => record.transport)).toEqual(['form', 'form', 'form']);
            expect(JSON.stringify(records)).not.toContain('-_');
        } finally {
            restore('HTMLFormElement', originalForm);
            restore('FormData', originalFormData);
            restore('document', originalDocument);
            delete scope.__SS_TRIPWIRE__;
            delete scope.__SS_TRIPWIRE_EMIT__;
        }
    });

    it('CASUALTY: relative payload URLs resolve against the deployed app before redaction', () => {
        expect(sanitizeCanaryPayloadUrl('/index.html?cache-bust=secret', 'https://speaksharp-public.vercel.app/session'))
            .toBe('https://speaksharp-public.vercel.app');
        expect(sanitizeCanaryPayloadUrl('https://api.example.test/save?token=secret', 'https://speaksharp-public.vercel.app/session'))
            .toBe('https://api.example.test');
        expect(sanitizeCanaryPayloadUrl(undefined, 'https://speaksharp-public.vercel.app/session'))
            .toBe('<unparseable>');
    });

    it('CASUALTY: approved-origin query values are classified before redaction without retaining content', () => {
        const pcm = 'A'.repeat(512);
        const appUrl = 'https://speaksharp-public.vercel.app/session';
        expect(canaryQueryContainsEncodedAudio(
            `https://speaksharp-public.vercel.app/api?audio=${pcm}`,
            appUrl,
        )).toBe(true);
        expect(canaryQueryContainsEncodedAudio(
            `https://eu.posthog.com/e/?q=${pcm}`,
            appUrl,
        )).toBe(true);
        expect(canaryQueryContainsEncodedAudio(
            'https://abcproject.supabase.co/rest/v1/sessions?select=id%2Ctotal_words%2Cduration&limit=20',
            appUrl,
        )).toBe(false);
    });

    it('CASUALTY: approved-origin path values are classified before redaction without retaining content', () => {
        const pcm = 'A'.repeat(512);
        const appUrl = 'https://speaksharp-public.vercel.app/session';
        expect(canaryPathContainsEncodedAudio(
            `https://speaksharp-public.vercel.app/api/${encodeURIComponent(pcm)}`,
            appUrl,
        )).toBe(true);
        expect(canaryPathContainsEncodedAudio(
            `https://eu.posthog.com/e/${encodeURIComponent(pcm)}`,
            appUrl,
        )).toBe(true);
        expect(canaryPathContainsEncodedAudio(
            'https://abcproject.supabase.co/rest/v1/sessions',
            appUrl,
        )).toBe(false);
    });

    it('CASUALTY: path contents are never copied into canary evidence', () => {
        const secretPath = 'private transcript words that must not enter CI';
        const safe = sanitizeCanaryPayloadUrl(
            `https://huggingface.co/${encodeURIComponent(secretPath)}`,
            'https://speaksharp-public.vercel.app/session',
        );
        expect(safe).toBe('https://huggingface.co');
        expect(safe).not.toContain('private');
        expect(safe).not.toContain(encodeURIComponent(secretPath));
    });

    const POLICY = {
        firstParty: ['https://speaksharp-public.vercel.app', 'https://abcproject.supabase.co'],
        governedTelemetry: ['https://eu.posthog.com'],
        modelAssets: ['https://huggingface.co', 'https://cdn-lfs.huggingface.co'],
    };
    const obs = (over = {}) => ({
        redacted: 'https://speaksharp-public.vercel.app/x', origin: 'https://speaksharp-public.vercel.app',
        bodyBytes: 0, resourceType: 'fetch', hasQuery: false,
        queryContainsEncodedAudio: false, pathContainsEncodedAudio: false, ...over,
    });

    it('CASUALTY: binary/multipart to a third party FAILS — postData() would have reported no body', () => {
        expect(judgeCanaryEgress([obs({
            redacted: 'https://stt.example.com/v1/transcribe', origin: 'https://stt.example.com',
            bodyBytes: 480_000, resourceType: 'fetch',
        })], [], POLICY)).toEqual({ ok: false, category: 'undeclared_destination', url: 'https://stt.example.com/v1/transcribe' });
    });

    it('CASUALTY: an UNRELATED Supabase project FAILS — a suffix allowlist would have admitted it', () => {
        expect(judgeCanaryEgress([obs({
            redacted: 'https://attacker.supabase.co/rest/v1/x', origin: 'https://attacker.supabase.co', bodyBytes: 900,
        })], [], POLICY)).toEqual({ ok: false, category: 'undeclared_destination', url: 'https://attacker.supabase.co/rest/v1/x' });
    });

    it('CASUALTY: query-string exfiltration FAILS with NO body at all', () => {
        expect(judgeCanaryEgress([obs({
            redacted: 'https://evil.example.com/p', origin: 'https://evil.example.com',
            bodyBytes: 0, hasQuery: true,
        })], [], POLICY)).toEqual({ ok: false, category: 'undeclared_destination', url: 'https://evil.example.com/p' });
    });

    it('CASUALTY: encoded audio in a query FAILS at every approved origin', () => {
        for (const origin of [
            'https://speaksharp-public.vercel.app',
            'https://abcproject.supabase.co',
            'https://eu.posthog.com',
        ]) {
            expect(judgeCanaryEgress([obs({
                redacted: origin,
                origin,
                bodyBytes: 0,
                hasQuery: true,
                queryContainsEncodedAudio: true,
            })], [], POLICY)).toEqual({ ok: false, category: 'encoded_audio_query', url: origin });
        }
    });

    it('CASUALTY: encoded audio in a path FAILS at every approved origin', () => {
        for (const origin of [
            'https://speaksharp-public.vercel.app',
            'https://abcproject.supabase.co',
            'https://eu.posthog.com',
        ]) {
            expect(judgeCanaryEgress([obs({
                redacted: origin,
                origin,
                bodyBytes: 0,
                pathContainsEncodedAudio: true,
            })], [], POLICY)).toEqual({ ok: false, category: 'encoded_audio_path', url: origin });
        }
    });

    it('CASUALTY: an UNDETERMINED body state FAILS closed, never skipped', () => {
        expect(judgeCanaryEgress([obs({ bodyBytes: null })], [], POLICY))
            .toEqual({ ok: false, category: 'undetermined_body_state', url: 'https://speaksharp-public.vercel.app/x' });
    });

    it('POSITIVE CONTROL: the exact configured Sentry ingest origin is governed', () => {
        const policy = {
            ...POLICY,
            governedTelemetry: [...POLICY.governedTelemetry, 'https://o123.ingest.us.sentry.io'],
        };
        expect(judgeCanaryEgress([obs({
            redacted: 'https://o123.ingest.us.sentry.io',
            origin: 'https://o123.ingest.us.sentry.io',
            bodyBytes: 900,
            resourceType: 'fetch',
        })], [], policy)).toEqual({ ok: true, inspected: 1, channels: 0 });
    });

    it('CASUALTY: an ungoverned WebSocket FAILS — later frames are invisible to request inspection', () => {
        expect(judgeCanaryEgress([], [{
            redacted: 'wss://relay.example.com/s', origin: 'wss://relay.example.com', kind: 'websocket',
        }], POLICY)).toEqual({ ok: false, category: 'ungoverned_websocket', url: 'wss://relay.example.com/s' });
        expect(judgeCanaryEgress([], [{
            redacted: 'https://evil.example.com/stream', origin: 'https://evil.example.com', kind: 'eventsource',
        }], POLICY)).toEqual({ ok: false, category: 'ungoverned_eventsource', url: 'https://evil.example.com/stream' });
    });

    it('CASUALTY: a BODY to a model-asset origin FAILS — a download is a read', () => {
        expect(judgeCanaryEgress([obs({
            redacted: 'https://cdn-lfs.huggingface.co', origin: 'https://cdn-lfs.huggingface.co', bodyBytes: 1,
        })], [], POLICY)).toEqual({ ok: false, category: 'model_origin_request_during_take', url: 'https://cdn-lfs.huggingface.co' });
    });

    it('CASUALTY: every query to a model origin FAILS, including ordinary fetch', () => {
        expect(judgeCanaryEgress([obs({
            redacted: 'https://huggingface.co', origin: 'https://huggingface.co',
            bodyBytes: 0, resourceType: 'fetch', hasQuery: true,
        })], [], POLICY)).toEqual({
            ok: false, category: 'model_origin_request_during_take', url: 'https://huggingface.co',
        });
    });

    it('CASUALTY: a bodyless model-origin path cannot smuggle transcript text', () => {
        expect(judgeCanaryEgress([obs({
            redacted: 'https://huggingface.co', origin: 'https://huggingface.co',
            bodyBytes: 0, resourceType: 'fetch', hasQuery: false,
        })], [], POLICY)).toEqual({
            ok: false, category: 'model_origin_request_during_take', url: 'https://huggingface.co',
        });
    });

    it('fails closed on an unparseable URL', () => {
        expect(judgeCanaryEgress([obs({ origin: '', redacted: '<unparseable>' })], [], POLICY))
            .toEqual({ ok: false, category: 'unparseable_egress_url', url: '<unparseable>' });
    });

    it('POSITIVE CONTROL: first-party save and governed JSON telemetry pass after model readiness', () => {
        expect(judgeCanaryEgress([
            obs({ redacted: 'https://abcproject.supabase.co/rest/v1/sessions', origin: 'https://abcproject.supabase.co', bodyBytes: 512, hasQuery: true }),
            obs({ redacted: 'https://eu.posthog.com/e/', origin: 'https://eu.posthog.com', bodyBytes: 2048 }),
        ], [{ redacted: 'wss://abcproject.supabase.co/realtime', origin: 'wss://abcproject.supabase.co', kind: 'websocket' }],
            { ...POLICY, firstParty: [...POLICY.firstParty, 'wss://abcproject.supabase.co'] },
        )).toEqual({ ok: true, inspected: 2, channels: 1 });
    });

    it('verdict accessors work without discriminated-union narrowing (e2e tsconfig is non-strict)', () => {
        expect(verdictCategory({ ok: true })).toBe('none');
        expect(verdictCategory({ ok: false, category: 'take_did_not_save' } as never)).toBe('take_did_not_save');
        expect(verdictUrl({ ok: true })).toBe('');
    });
});
