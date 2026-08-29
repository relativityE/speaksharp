/**
 * #1304 Task 3C — CERTIFICATION.
 *
 * An arm may not produce a selection row until it has passed every gate here. The gates are the
 * immutable rules in `rules.ts`; nothing on this path takes a threshold, a tolerance or a target as an
 * argument, because a gate a caller can choose is a gate a caller can choose to pass.
 *
 * The retired `0.0936` gate asked a new harness to reproduce a historical figure. What certifies a
 * harness is not agreement with a remembered number — it is that it decodes on the SAME ROUTE the
 * product ships, normalizes EXACTLY as the official scorer does, and turns audio into a pooled WER by
 * arithmetic that has been run and checked. Each of those is proven by executing it.
 */
import { runOracleVectorGate, type OracleGateResult } from './scoringAdapter';
import { checkRouteParity, type RouteExpectation, type RouteParityResult } from './routeParity';
import { checkProvenance, type ProvenanceCheck } from './provenance';
import { CERTIFICATION_RULES } from './rules';
import { fingerprintConfiguration, type ConfigurationFingerprint } from './fingerprint';
import type { DecodeArm, RouteHonorReport } from './engineArm';

export interface CertificationResult {
    certified: boolean;
    rulesVersion: string;
    armId: string;
    /**
     * The configuration this certificate vouches for. Re-computed at emission and compared, because a
     * name is not a configuration: an arm can keep its id and change its dtype, device, revision or
     * runtime version.
     */
    fingerprint: ConfigurationFingerprint;
    gates: {
        routeParity: RouteParityResult;
        /** Present only when a probe was supplied — see `certifyArmWithHonorProbe`. */
        routeHonored: RouteHonorReport | null;
        oracleVectors: OracleGateResult;
        provenance: ProvenanceCheck;
    };
    /** Every gate that did not pass, named. An uncertified arm must say WHY, not merely fail. */
    failedGates: string[];
}

/**
 * Certify from the gates that need no audio. `routeHonored` is null here, and an arm certified this
 * way has NOT been shown to have its route applied — only declared. Use `certifyArmWithHonorProbe`
 * before measuring anything.
 */
export function certifyArm(
    arm: DecodeArm,
    expectation: RouteExpectation,
    oracleVectors: readonly { category: string; input: string; expected: string }[],
    routeHonored: RouteHonorReport | null = null,
): CertificationResult {
    const routeParity = checkRouteParity(arm, expectation);
    const oracle = runOracleVectorGate(oracleVectors);
    const provenance = checkProvenance(arm.provenance());

    const failedGates: string[] = [];
    if (!routeParity.ok) failedGates.push('route_parity');
    if (!oracle.ok) failedGates.push('oracle_vectors');
    if (!provenance.ok) failedGates.push('provenance');
    if (routeHonored !== null) {
        // A requested setting the runtime silently dropped, or a device it cannot show it used.
        if (routeHonored.timestampsRequested !== routeHonored.timestampsReturned) failedGates.push('route_not_honored');
        // A DEVICE CLAIM must be proven; an accuracy arm makes none and is not asked to.
        if (routeHonored.deviceClaim !== 'none') {
            if (!routeHonored.deviceVerifiable) failedGates.push('device_unverifiable');
            // Echoing the requested device back tells you nothing about what actually ran.
            if (routeHonored.deviceResolved === null) failedGates.push('backend_unresolved');
        }
    }

    return {
        certified: failedGates.length === 0,
        rulesVersion: CERTIFICATION_RULES.version,
        armId: arm.id,
        fingerprint: fingerprintConfiguration(arm.id, arm.provenance(), routeHonored?.deviceClaim ?? 'none'),
        gates: { routeParity, routeHonored, oracleVectors: oracle, provenance },
        failedGates,
    };
}

/**
 * The full certification: everything above, plus a real short decode proving the runtime APPLIED the
 * route rather than merely accepting it. This is the form that gates a measurement.
 */
export async function certifyArmWithHonorProbe(
    arm: DecodeArm,
    expectation: RouteExpectation,
    oracleVectors: readonly { category: string; input: string; expected: string }[],
    /** File path or URL of the probe clip — the arm resolves it, exactly as it does a corpus clip. */
    probeLocator: string,
    probeSeconds: number,
): Promise<CertificationResult> {
    let honored: RouteHonorReport;
    try {
        honored = await arm.probeRouteHonored(probeLocator, probeSeconds);
    } catch (error) {
        honored = {
            timestampsRequested: true,
            timestampsReturned: false,
            deviceRequested: 'unknown',
            deviceClaim: 'none',
            deviceResolved: null,
            deviceVerifiable: false,
            detail: `probe threw: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    return certifyArm(arm, expectation, oracleVectors, honored);
}
