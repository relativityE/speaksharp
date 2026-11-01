/**
 * THE DEFAULT LOADER'S BINDING TO THE REAL RUNTIME.
 *
 * Every other test in this suite injects a fake transcriber, so none of them ever touch the runtime's
 * `ModelArch` enum — which is precisely where the engine was wrong: it indexed the enum with its OWN
 * token. This file imports the INSTALLED `@moonshine-ai/moonshine-wasm` and binds against the real
 * enum. It downloads no weights, so it runs in CI like any other unit test.
 */
import { describe, expect, it } from 'vitest';
import { resolveModelArch } from '../MoonshineStreamingEngine';
import { CANDIDATES } from '../../candidateRegistry';

// The runtime member each registered Moonshine candidate loads as is its own DATA (decode.runtimeArch), not a code map (PO 11-01).
const MEMBERS: Record<string, string> = Object.fromEntries(Object.values(CANDIDATES)
    .filter((c) => c.engine === 'moonshine-streaming' && c.execution.decode.kind === 'moonshine-streaming')
    .map((c) => [c.execution.modelArch!, (c.execution.decode as { runtimeArch: string }).runtimeArch]));
const ARCHES = Object.keys(MEMBERS);

describe('the engine token resolves against the REAL runtime enum', () => {
    it('CASUALTY: every arch resolves to a defined member of the installed ModelArch', async () => {
        // Indexing the enum with `MOONSHINE_STREAMING_MEDIUM` returns undefined. An undefined arch does
        // not announce itself — it throws deep in the runtime, or selects the zero member (`Tiny`),
        // which would decode with a different model while metadata reported the one we asked for.
        const { ModelArch } = await import('@moonshine-ai/moonshine-wasm') as unknown as
            { ModelArch: Record<string, unknown> };
        for (const arch of ARCHES) {
            const value = resolveModelArch(ModelArch, MEMBERS[arch], arch);
            expect(typeof value).toBe('number');
            // Reverse-mapped enum: the number must map back to the member the candidate names.
            expect(ModelArch[String(value)]).toBe(MEMBERS[arch]);
        }
    });

    it('CASUALTY: the two arches are DISTINCT members — small and medium are not the same model', async () => {
        const { ModelArch } = await import('@moonshine-ai/moonshine-wasm') as unknown as
            { ModelArch: Record<string, unknown> };
        const [small, medium] = [
            resolveModelArch(ModelArch, MEMBERS.MOONSHINE_STREAMING_SMALL, 'MOONSHINE_STREAMING_SMALL'),
            resolveModelArch(ModelArch, MEMBERS.MOONSHINE_STREAMING_MEDIUM, 'MOONSHINE_STREAMING_MEDIUM'),
        ];
        expect(small).not.toBe(medium);
        expect(ModelArch[String(small)]).toBe('SmallStreaming');
        expect(ModelArch[String(medium)]).toBe('MediumStreaming');
    });

    it('CASUALTY: never resolves to the enum ZERO member by accident', async () => {
        // The failure that would be invisible: `Tiny = 0` is falsy, so a `?? fallback` or a truthiness
        // guard elsewhere could route a real selection to the tiniest model silently.
        const { ModelArch } = await import('@moonshine-ai/moonshine-wasm') as unknown as
            { ModelArch: Record<string, unknown> };
        expect(ARCHES.length).toBe(2);
        for (const arch of ARCHES) expect(resolveModelArch(ModelArch, MEMBERS[arch], arch)).not.toBe(0);
    });

    it('FAILS CLOSED when the runtime does not declare the member', () => {
        // A runtime upgrade that renames or drops a member must break loudly here, not pass `undefined`
        // to load() at a user's first session.
        expect(() => resolveModelArch({ SmallStreaming: 4 }, 'MediumStreaming', 'MOONSHINE_STREAMING_MEDIUM'))
            .toThrow(/does not declare ModelArch\.MediumStreaming for MOONSHINE_STREAMING_MEDIUM/);
        expect(() => resolveModelArch({ MediumStreaming: 'five' }, 'MediumStreaming'))
            .toThrow(/does not declare/);
        // Data cannot reach the enum's reverse map or the prototype: a numeric key or an inherited name is not a member.
        expect(() => resolveModelArch({ 4: 'SmallStreaming', SmallStreaming: 4 }, '4')).toThrow(/does not declare/);
        expect(() => resolveModelArch(Object.create({ MediumStreaming: 5 }), 'MediumStreaming')).toThrow(/does not declare/);
    });
});
