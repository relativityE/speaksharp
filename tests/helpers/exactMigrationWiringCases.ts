import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { EXACT_MIGRATION_ALLOWLIST, assertExactDryRun, resolveExactMigrationConfig } from '../../scripts/lib/exactMigrationGate.mjs';

export function assertMigrationBytePin(path: string, actualHash: string) {
    expect(actualHash).toBe(createHash('sha256').update(readFileSync(path)).digest('hex'));
}

type MigrationEntry = typeof EXACT_MIGRATION_ALLOWLIST[number];

export function assertStagedMigrationOrder(file: string, version: MigrationEntry['version'], previous: MigrationEntry['version'], activation: MigrationEntry) {
    const entry = EXACT_MIGRATION_ALLOWLIST.find(item => item.version === version);
    const order = EXACT_MIGRATION_ALLOWLIST.map(item => item.version);
    expect(entry).toMatchObject({ file, classification: 'staged' });
    expect(order.indexOf(version)).toBe(order.indexOf(previous) + 1);
    expect(EXACT_MIGRATION_ALLOWLIST.findIndex(item => item.version === version)).toBeLessThan(EXACT_MIGRATION_ALLOWLIST.indexOf(activation));
}

export function assertTargetOnlyDryRunCases(file: string, additionalFile: string, config: ReturnType<typeof resolveExactMigrationConfig>) {
    for (const [{ files }, extra] of [[{ files: [file] }, false], [{ files: [file, additionalFile] }, true]] as const) {
        const output = `Would push these migrations:\n${files.map(name => ` • ${name}`).join('\n')}\n`;
        if (extra) expect(() => assertExactDryRun(output, config)).toThrow(/target-only/);
        else expect(assertExactDryRun(output + 'Finished supabase db push.', config).files).toEqual([file]);
    }
}
