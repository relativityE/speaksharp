import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getUserFacingEngineLabel } from '@/utils/engineLabels';

/**
 * PROD-DIAG-GUARDS items 2–3 (priority 10): production must not leak internal diagnostics into
 * user-facing copy. These are test-only regression locks — no runtime behavior change.
 *
 *  - Behavioral: the engine-label mapper never returns a raw model/runtime/device identifier.
 *  - Source lock: the user-facing render layer (components/ + pages/) must contain NO raw model
 *    artifact / runtime / vendor identifiers. The layer is clean today; this keeps it clean.
 */

const here = dirname(fileURLToPath(import.meta.url)); // frontend/src/__tests__
const RENDER_LAYER_DIRS = [join(here, '..', 'components'), join(here, '..', 'pages')];

// Raw identifiers that must never appear in user-facing render-layer source. Friendly labels
// (Private / Higher Accuracy Private Model / Native Device Transcription / Cloud) are used instead.
const FORBIDDEN_TOKENS = [
    'vault mode',
    'onnxruntime',
    'onnx-community',
    '.onnx',
    'huggingface',
    'xenova/',
    'transformers-js',
    'whisper-tiny',
    'whisper-base',
    'whisper-small',
    'q4f16',
    'fp32',
];

// Escape hatch: if a token legitimately must appear, add "<file>::<token>" here with a reason.
const ALLOWLIST = new Set<string>([]);

function walk(dir: string): string[] {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
        // Scan PRODUCTION render-layer source only — tests legitimately use raw engine ids as fixtures.
        if (entry === '__tests__') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out = out.concat(walk(full));
        } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

describe('engine label mapper never leaks raw engine/model identifiers (item 3)', () => {
    const friendly = new Set(['Cloud', 'Private', 'Browser', 'Not recorded']);
    const rawTokens = ['onnx', 'wasm', 'whisper', 'transformers', 'xenova', 'q4', 'q8', 'fp32', 'huggingface'];

    for (const engine of [
        'whisper-base.en',
        'transformers-js',
        'onnxruntime-web',
        'Xenova/whisper-tiny.en',
        'private-whisper-wasm-q8',
        'assemblyai-cloud',
        'native-browser',
        'unknown-engine',
        '',
    ]) {
        it(`maps "${engine || '(empty)'}" to a friendly label with no raw token`, () => {
            const label = getUserFacingEngineLabel({ engine } as Parameters<typeof getUserFacingEngineLabel>[0]);
            expect(friendly.has(label)).toBe(true);
            const lower = label.toLowerCase();
            for (const raw of rawTokens) expect(lower).not.toContain(raw);
        });
    }
});

describe('user-facing render layer contains no raw diagnostic/model tokens (items 2–3)', () => {
    const files = RENDER_LAYER_DIRS.flatMap((d) => {
        try {
            return walk(d);
        } catch {
            return [];
        }
    });

    it('scans a non-trivial number of component/page files', () => {
        expect(files.length).toBeGreaterThan(10);
    });

    it('has no forbidden raw token anywhere in components/ or pages/', () => {
        const violations: string[] = [];
        for (const file of files) {
            const text = readFileSync(file, 'utf8').toLowerCase();
            for (const token of FORBIDDEN_TOKENS) {
                if (text.includes(token) && !ALLOWLIST.has(`${file}::${token}`)) {
                    violations.push(`${file} contains forbidden token "${token}"`);
                }
            }
        }
        // Single-arg expect (eslint vitest/valid-expect): the joined list is the failure message.
        expect(violations.join('\n')).toBe('');
    });
});
