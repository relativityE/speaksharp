import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const key = row => row.caseId + '/' + row.assertion;

/** Structural coverage protection, not product proof or release authorization. */
export function validateMapping(catalog, mapping) {
  const errors = [];
  const expected = new Set(Object.entries(catalog.cases).flatMap(([caseId, spec]) =>
    spec.requiredAssertions.map(assertion => key({ caseId, assertion }))));
  if (expected.size !== catalog.totalAssertions) errors.push('catalog denominator mismatch');
  if (mapping.status !== 'proposal-not-executable') errors.push('mapping must remain non-executable');
  const journeys = new Map();
  for (const journey of mapping.journeys || []) {
    if (journeys.has(journey.id)) errors.push('duplicate journey ' + journey.id);
    journeys.set(journey.id, journey);
    for (const field of ['title', 'uniqueRisk', 'isolation', 'passEvidence']) {
      if (!nonempty(journey[field])) errors.push(journey.id + ': missing ' + field);
    }
  }
  const caseOwners = new Map();
  for (const journey of journeys.values()) {
    for (const caseId of journey.cases || []) {
      if (!catalog.cases[caseId]) errors.push('unknown original case ' + caseId);
      if (caseOwners.has(caseId)) errors.push('case assigned twice ' + caseId);
      caseOwners.set(caseId, journey.id);
    }
  }
  const seen = new Set();
  for (const row of mapping.rows || []) {
    const id = key(row);
    if (seen.has(id)) errors.push('duplicate assertion ' + id);
    seen.add(id);
    if (!expected.has(id)) errors.push('unknown assertion ' + id);
    if (!journeys.has(row.journey) || caseOwners.get(row.caseId) !== row.journey) {
      errors.push(id + ': wrong journey');
    }
    if (!nonempty(row.reason)) errors.push(id + ': missing rationale');
    const dispositions = ['keep-safety', 'keep-live', 'fast-first-retain-live-until-proven', 'demote-with-reviewed-proof'];
    if (!dispositions.includes(row.disposition)) errors.push(id + ': invalid disposition');
    if (row.disposition === 'fast-first-retain-live-until-proven' &&
        (!Array.isArray(row.candidateFastTests) || !row.candidateFastTests.length ||
         row.candidateFastTests.some(path => !nonempty(path)))) {
      errors.push(id + ': missing fast-test destination');
    }
    if (row.disposition === 'demote-with-reviewed-proof') {
      const proof = row.replacementProof;
      if (!proof || !['testPath', 'behavioralAssertion', 'baselineEvidence', 'mutationEvidence', 'reviewEvidence']
          .every(field => nonempty(proof[field])) || !/^[a-f0-9]{40}$/.test(proof?.sourceSha || '')) {
        errors.push(id + ': demotion lacks bound behavioral and mutation proof');
      }
    }
    if (['owner-bound', 'start-press-budget', 'no-cloud-stt', 'owned-pages-closed'].includes(row.assertion) &&
        row.disposition !== 'keep-safety') errors.push(id + ': live safety observation cannot be demoted');
  }
  for (const id of expected) if (!seen.has(id)) errors.push('missing assertion ' + id);
  for (const caseId of Object.keys(catalog.cases)) if (!caseOwners.has(caseId)) errors.push('unmapped case ' + caseId);
  const billing = mapping.additionalRequirements?.find(row => row.id === 'billing-expiry-restoration');
  if (!billing || !journeys.has(billing.journey) || !nonempty(billing.acceptance) ||
      !Array.isArray(billing.prerequisites) || billing.prerequisites.length < 3) {
    errors.push('billing needs acceptance and explicit prerequisites');
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [catalogPath, mappingPath] = process.argv.slice(2);
  if (!catalogPath || !mappingPath) {
    process.stderr.write('Usage: node validate.mjs <catalog.json> <mapping.json>\n');
    process.exitCode = 2;
  } else {
    const errors = validateMapping(JSON.parse(readFileSync(catalogPath, 'utf8')),
      JSON.parse(readFileSync(mappingPath, 'utf8')));
    if (errors.length) {
      process.stderr.write(errors.join('\n') + '\n');
      process.exitCode = 1;
    } else process.stdout.write('Mapping complete. Proposal only: no product, migration, deployment or live-test qualification.\n');
  }
}
