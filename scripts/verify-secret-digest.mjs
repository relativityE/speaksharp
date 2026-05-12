import { createHash } from 'node:crypto';

const label = process.env.SECRET_DIGEST_LABEL || 'secret';
const value = process.env.SECRET_VALUE;
const expected = process.env.EXPECTED_SHA256;

if (!value) {
  console.error(`${label}: missing SECRET_VALUE`);
  process.exit(2);
}

if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
  console.error(`${label}: missing or invalid EXPECTED_SHA256`);
  process.exit(2);
}

const actual = createHash('sha256').update(value, 'utf8').digest('hex');
const matches = actual.toLowerCase() === expected.toLowerCase();

console.log(`${label}: digest_match=${matches}`);

if (!matches) {
  process.exit(1);
}
