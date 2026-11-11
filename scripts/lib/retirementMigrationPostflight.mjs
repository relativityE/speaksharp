// Exact catalog-only retirement gate. Never invokes a business RPC or reads account data.
import { T2_VERSIONS, RETIREMENT_VERSION, t2ReleaseContract,
  t2ReleaseSnapshotQuery, assertT2ReleaseSnapshot } from './t2MigrationPostflight.mjs';
import { C1_VERSIONS } from './c1MigrationPostflight.mjs';

export function retirementContract(root, mode, version, catalogContext = 'retained-production') {
  if (!['before', 'after'].includes(mode) || version !== RETIREMENT_VERSION) {
    throw new Error('retirement phase/target invalid');
  }
  const predecessor = [...T2_VERSIONS, ...C1_VERSIONS];
  // Bind the successor source even BEFORE application; source presence is not installation.
  const successor = t2ReleaseContract(root, [...predecessor, version], { catalogContext });
  const release = mode === 'after' ? successor : t2ReleaseContract(root, predecessor, { catalogContext });
  return { mode, version, targetSha256: successor.pins.at(-1).sha256, release,
    predecessor: t2ReleaseContract(root, predecessor, { catalogContext }) };
}

export const retirementSnapshotQuery = contract => t2ReleaseSnapshotQuery(contract.release);

export function assertRetirementSnapshot(contract, rows, prior) {
  const result = assertT2ReleaseSnapshot(contract.release, rows);
  const activation = JSON.parse(rows[4]).activation;
  if (contract.mode === 'after') {
    if (!prior || prior.version !== contract.version || prior.targetSha256 !== contract.targetSha256
      || prior.catalogContext !== contract.release.catalogContext || !Array.isArray(prior.rows)) {
      throw new Error('retirement prior receipt missing or mismatched');
    }
    const beforeLedger = [...T2_VERSIONS, ...C1_VERSIONS];
    assertT2ReleaseSnapshot(contract.predecessor, prior.rows);
    if (prior.rows.length !== 6 || JSON.stringify(JSON.parse(prior.rows[0])) !== JSON.stringify(beforeLedger)
      || JSON.stringify(JSON.parse(prior.rows[4]).activation) !== JSON.stringify(activation)
      || prior.rows[2] !== rows[2]) {
      throw new Error('retirement prior ledger or activation changed');
    }
  }
  return { ...result, mode: contract.mode, version: contract.version };
}
