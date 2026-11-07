import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNotMaintainedIdentity, MAINTAINED_ACCOUNT_VARIABLES } from './identityExclusion.mjs';

const DISPOSABLE = 'eval-disposable@example.test';

test('a maintained account login refuses, whatever its case or surrounding space', () => {
  for (const name of MAINTAINED_ACCOUNT_VARIABLES) {
    assert.throws(() => assertNotMaintainedIdentity(' Shared@Example.test ', { [name]: 'shared@example.test' }),
      new RegExp(`^Error: bounded_identity_is_maintained:${name}$`));
  }
});

test('the approved disposable login passes and the receipt names only the variables compared', () => {
  const receipt = assertNotMaintainedIdentity(DISPOSABLE, { FREE_TEST_EMAIL: 'free@example.test', PRO_TEST_EMAIL: 'pro@example.test' });
  assert.deepEqual(receipt.maintainedCompared, ['FREE_TEST_EMAIL', 'PRO_TEST_EMAIL']);
  assert.deepEqual(receipt.maintainedNotVisible, ['CHECKOUT_TEST_EMAIL', 'CANARY_TRIAL_EMAIL', 'CANARY_PAID_EMAIL']);
  assert.equal(JSON.stringify(receipt).includes('@'), false, 'no email reaches the receipt');
});

test('no visible maintained variable is reported as not compared, never as proof', () => {
  const receipt = assertNotMaintainedIdentity(DISPOSABLE, {});
  assert.deepEqual(receipt.maintainedCompared, []);
  assert.deepEqual(receipt.maintainedNotVisible, [...MAINTAINED_ACCOUNT_VARIABLES]);
});

test('a missing login refuses', () => {
  for (const email of [undefined, '', '   ']) assert.throws(() => assertNotMaintainedIdentity(email, {}), /^Error: bounded_identity_missing$/);
});
