/**
 * #1304 Task 3C — WHAT A CERTIFICATE IS ACTUALLY FOR.
 *
 * The first binding compared `certification.armId` to `arm.id`. A name is not a configuration: an arm
 * can keep its id and change its dtype, its device, its model revision or its runtime version, and the
 * certificate would still appear to belong to it. The certificate would then be vouching for a decode
 * that never happened.
 *
 * The fingerprint covers everything that changes what a decode IS — model identity and revision, the
 * digests of the weights read, the resolved route, the runtime and its version, and the backend
 * claimed. Two runs with the same fingerprint are the same configuration; anything else is a different
 * arm wearing the same name.
 */
import { createHash } from 'node:crypto';
import type { ArmProvenance } from './engineArm';

export interface ConfigurationFingerprint {
    /** Short digest carried on rows and compared at emission. */
    digest: string;
    /** The exact fields it was computed from, so a mismatch can be explained rather than just reported. */
    parts: Record<string, string>;
}

export function fingerprintConfiguration(
    armId: string,
    provenance: ArmProvenance,
    deviceClaim: string,
): ConfigurationFingerprint {
    // Weight digests are folded into one value so the fingerprint stays readable while still changing
    // if any single file changes.
    const weights = createHash('sha256')
        .update(JSON.stringify(Object.entries(provenance.model.filesSha256).sort()))
        .digest('hex');

    const parts: Record<string, string> = {
        armId,
        modelId: provenance.model.id,
        modelRevision: provenance.model.revision,
        weights,
        runtime: `${provenance.runtime.library}@${provenance.runtime.version}`,
        backend: provenance.runtime.backend,
        deviceClaim,
        assets: `${provenance.assets.source}:${provenance.assets.verdict}`,
        route: provenance.route.hash,
        // The exact selection, not just its version label: a coherently shrunken manifest keeps the
        // version and changes this.
        corpus: `${provenance.corpus.version}@${provenance.corpus.digest}`,
    };

    // Sorted, so property order cannot change the digest.
    const canonical = JSON.stringify(Object.entries(parts).sort());
    return { digest: createHash('sha256').update(canonical).digest('hex').slice(0, 16), parts };
}

/** Which fields differ. Naming them turns "mismatch" into something actionable. */
export function fingerprintDifferences(
    a: ConfigurationFingerprint,
    b: ConfigurationFingerprint,
): string[] {
    const keys = new Set([...Object.keys(a.parts), ...Object.keys(b.parts)]);
    return [...keys].filter((k) => a.parts[k] !== b.parts[k]).sort();
}
