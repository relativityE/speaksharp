import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);

/**
 * The INSTALLED version of a package, read from its own `package.json`.
 *
 * Not `require('pkg/package.json')`: `@huggingface/transformers` does not list `./package.json` in its
 * `exports`, so that throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolving the entry point and walking up to
 * the nearest `package.json` works regardless of what a package chooses to export.
 *
 * Returns null rather than a placeholder. `'unknown'` is a missing value wearing a value's clothes,
 * and the provenance gate now rejects it — correctly.
 */
export function installedVersion(packageName: string): string | null {
    try {
        let dir = dirname(require_.resolve(packageName));
        for (let depth = 0; depth < 8; depth++) {
            const candidate = join(dir, 'package.json');
            if (existsSync(candidate)) {
                const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
                if (parsed.name === packageName && parsed.version) return parsed.version;
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * #1304 Task 3C — READ THE BACKEND THAT RAN, do not echo the one that was requested.
 *
 * `device: 'webgpu'` is accepted in Node, where `navigator.gpu` does not exist, and a transcript comes
 * out regardless. Reporting the request back would have recorded a WebGPU result that never touched a
 * GPU. The only admissible evidence is something the runtime says about itself AFTER loading.
 *
 * onnxruntime exposes the execution providers on each InferenceSession. transformers.js keeps those
 * sessions on the model object under names that vary by architecture, so this walks the object rather
 * than assuming a shape — and returns null when it finds nothing, which FAILS the gate. An
 * unresolvable backend is not a passing backend.
 */
export function readSessionProviders(pipelineOrModel: unknown): string | null {
    const seen = new Set<unknown>();
    const providers = new Set<string>();

    const walk = (node: unknown, depth: number) => {
        if (depth > 4 || node === null || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        const record = node as Record<string, unknown>;

        // An ORT InferenceSession carries `inputNames`/`outputNames` and a handler holding the
        // providers actually used for this session.
        if (Array.isArray(record.inputNames) && Array.isArray(record.outputNames)) {
            const handler = record.handler as { _model?: { providers?: unknown }; providers?: unknown } | undefined;
            const list = (handler?.providers ?? handler?._model?.providers) as unknown;
            if (Array.isArray(list)) for (const p of list) providers.add(String(p));
        }
        for (const value of Object.values(record)) walk(value, depth + 1);
    };

    walk(pipelineOrModel, 0);
    return providers.size > 0 ? [...providers].sort().join('+') : null;
}
