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
import { checkRouteParity, type RouteParityResult } from './routeParity';
import { checkProvenance, type ProvenanceCheck } from './provenance';
import { CERTIFICATION_RULES } from './rules';
import type { DecodeArm } from './engineArm';

export interface CertificationResult {
    certified: boolean;
    rulesVersion: string;
    armId: string;
    gates: {
        routeParity: RouteParityResult;
        oracleVectors: OracleGateResult;
        provenance: ProvenanceCheck;
    };
    /** Every gate that did not pass, named. An uncertified arm must say WHY, not merely fail. */
    failedGates: string[];
}

export function certifyArm(
    arm: DecodeArm,
    engine: 'v2' | 'v4',
    modelId: string,
    oracleVectors: readonly { category: string; input: string; expected: string }[],
): CertificationResult {
    const routeParity = checkRouteParity(arm, engine, modelId);
    const oracle = runOracleVectorGate(oracleVectors);
    const provenance = checkProvenance(arm.provenance());

    const failedGates: string[] = [];
    if (!routeParity.ok) failedGates.push('route_parity');
    if (!oracle.ok) failedGates.push('oracle_vectors');
    if (!provenance.ok) failedGates.push('provenance');

    return {
        certified: failedGates.length === 0,
        rulesVersion: CERTIFICATION_RULES.version,
        armId: arm.id,
        gates: { routeParity, oracleVectors: oracle, provenance },
        failedGates,
    };
}
