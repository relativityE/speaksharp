import { describe, expect, it } from 'vitest';
import { CANDIDATES } from '../candidateRegistry';
import {
    acquisitionComponentGroupsFor, acquisitionScopeFor,
} from '../candidateAssetRequests';
import { observeAcquisitionNetwork } from '../acquisitionNetworkObservation';

const V2 = CANDIDATES['v2:base.en'];
const SCOPE = acquisitionScopeFor(V2);
const GROUPS = acquisitionComponentGroupsFor(V2);
const MODEL_PREFIX = SCOPE.find((prefix) => prefix.includes('/models/whisper-base.en/'))!;
const RUNTIME_PREFIX = SCOPE.find((prefix) => !prefix.includes('/models/'))!;
const REQUIRED_MODEL_URLS = GROUPS[0].expectedResourceUrls ?? [];
const MODEL_COUNT = REQUIRED_MODEL_URLS.length;
const START = 1_000;

type Resource = {
    name: string;
    transferSize: number;
    encodedBodySize: number;
    responseEnd: number;
    redirectStart?: number;
    redirectEnd?: number;
};

function modelResources(urls: string[] = REQUIRED_MODEL_URLS): Resource[] {
    return urls.map((name, i) => ({
        name,
        transferSize: 100 + i,
        encodedBodySize: 100 + i,
        responseEnd: START + 300 + i,
    }));
}

function runtimeResource(overrides: Partial<Resource> = {}): Resource {
    return {
        name: `${RUNTIME_PREFIX}ort-wasm-simd-threaded.wasm`,
        transferSize: 1_000,
        encodedBodySize: 1_000,
        responseEnd: START + 500,
        ...overrides,
    };
}

function observe(resources: Resource[]) {
    const perf = {
        getEntriesByType: (type: string) => type === 'resource'
            ? resources.map((resource) => ({ startTime: START, duration: 100, ...resource }))
            : [],
    } as unknown as Performance;
    return observeAcquisitionNetwork(SCOPE, START, perf, {
        timeline: 'exclusive', expectedComponents: null, expectedComponentGroups: GROUPS,
    });
}

describe('v2 cold pipeline acquisition inventory', () => {
    it('requires the exact seven pipeline model resources plus one selected ONNX Runtime WASM request', () => {
        expect(GROUPS).toEqual([
            { prefixes: [MODEL_PREFIX], minimumUniqueCount: 7, expectedResourceUrls: REQUIRED_MODEL_URLS },
            { prefixes: [RUNTIME_PREFIX], minimumUniqueCount: 1 },
        ]);
        const result = observe([...modelResources(), runtimeResource()]);
        expect(result.completeness).toBe('complete');
        expect(result.reasonCode).toBeNull();
        expect(result.assetCount).toBe(MODEL_COUNT + 1);
        expect(result.networkUsed).toBe(true);
        expect(result.networkBytes).toBeGreaterThan(0);
        expect(result.downloadMs).toBeGreaterThan(0);
    });

    it('fails closed when the runtime request or any model resource is missing', () => {
        const missingRuntime = observe(modelResources());
        expect(missingRuntime.completeness).toBe('partial');
        expect(missingRuntime.reasonCode).toBe('component_shortfall');

        // An extra runtime request cannot make up for a missing model file.
        const missingModel = observe([...modelResources(REQUIRED_MODEL_URLS.slice(0, -1)),
            runtimeResource(), runtimeResource({ name: `${RUNTIME_PREFIX}second-runtime-file.wasm` })]);
        expect(missingModel.completeness).toBe('partial');
        expect(missingModel.reasonCode).toBe('component_shortfall');
    });

    it('does not let duplicate requests satisfy a missing unique model component', () => {
        const incomplete = modelResources(REQUIRED_MODEL_URLS.slice(0, -1));
        incomplete.push({ ...incomplete[0] });
        const result = observe([...incomplete, runtimeResource()]);
        expect(result.assetCount).toBe(MODEL_COUNT + 1);
        expect(result.completeness).toBe('partial');
        expect(result.reasonCode).toBe('component_shortfall');
    });

    it('does not let another pinned but unused model file substitute for a required pipeline file', () => {
        const substituted = [
            ...REQUIRED_MODEL_URLS.slice(0, -1),
            `${MODEL_PREFIX}added_tokens.json`,
        ];
        const result = observe([...modelResources(substituted), runtimeResource()]);
        expect(result.assetCount).toBe(MODEL_COUNT + 1);
        expect(result.completeness).toBe('partial');
        expect(result.reasonCode).toBe('component_shortfall');
    });

    it('rejects out-of-scope and redirected requests', () => {
        const extra = observe([...modelResources(), runtimeResource(), {
            name: 'https://unrelated.invalid/asset.bin', transferSize: 20, encodedBodySize: 20,
            responseEnd: START + 600,
        }]);
        expect(extra.completeness).toBe('partial');
        expect(extra.reasonCode).toBe('requests_outside_scope');

        const redirected = observe([...modelResources(), runtimeResource({ redirectStart: START + 50, redirectEnd: START + 80 })]);
        expect(redirected.completeness).toBe('partial');
        expect(redirected.reasonCode).toBe('requests_redirected');
    });

    it('keeps opaque response sizes partial even with complete component coverage', () => {
        const result = observe([...modelResources(), runtimeResource({ transferSize: 0, encodedBodySize: 0 })]);
        expect(result.completeness).toBe('partial');
        expect(result.reasonCode).toBe('sizes_opaque');
        expect(result.networkBytes).toBeGreaterThan(0); // observer retains known bytes as partial evidence
        expect(result.downloadMs).toBeGreaterThan(0);
    });
});
