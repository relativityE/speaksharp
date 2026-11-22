import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

export function assertMigrationBytePin(path: string, actualHash: string) {
    expect(actualHash).toBe(createHash('sha256').update(readFileSync(path)).digest('hex'));
}

type MigrationEntry = Readonly<{ file: string; version: string; classification: string }>;
type DryRun = (output: string) => { files: readonly string[] };

export function assertStagedMigrationOrder(file: string, version: string, previous: string, activation: MigrationEntry, allowlist: readonly MigrationEntry[]) {
    const entry = allowlist.find(item => item.version === version);
    const order = allowlist.map(item => item.version);
    expect(entry).toMatchObject({ file, classification: 'staged' });
    expect(order.indexOf(version)).toBe(order.indexOf(previous) + 1);
    expect(allowlist.findIndex(item => item.version === version)).toBeLessThan(allowlist.indexOf(activation));
}

export function assertTargetOnlyDryRunCases(file: string, additionalFile: string, dryRun: DryRun) {
    for (const [{ files }, extra] of [[{ files: [file] }, false], [{ files: [file, additionalFile] }, true]] as const) {
        const output = `Would push these migrations:\n${files.map(name => ` • ${name}`).join('\n')}\n`;
        if (extra) expect(() => dryRun(output)).toThrow(/target-only/);
        else expect(dryRun(output + 'Finished supabase db push.').files).toEqual([file]);
    }
}
