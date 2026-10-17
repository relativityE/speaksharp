import { createHash } from 'node:crypto';

export const ACCOUNT_CLOSURE_ENFORCEMENT_SHA256 = '2613a3921d084d008d18e94834c59d0764c108b38385afbcb280cd01760bdce1';
// Ordered immutable schema117 + persistence118 + enforcement119 source hashes.
export const ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 = createHash('sha256').update(JSON.stringify([
    '8647483f6ed72d99246c84cb2d07571c34c7a5393268f8acd505edf267b03688',
    'd8a5b1d153890167869b2e7d366fb1ae3dd1272a67cd26f3980e6d2cd5233145',
    ACCOUNT_CLOSURE_ENFORCEMENT_SHA256,
])).digest('hex');
export const ENFORCED_JOURNAL_DIGEST = '2ba96771f0b774c1c8fcbfb8546e577d';
export const CLOSURE_OWNER_ONLY_ROUTINES = ['claim_account_closure_token', 'record_account_closure_auth_state',
    'settle_account_closure_billing', 'issue_account_closure_token', 'reconcile_expired_account_checkout'];
