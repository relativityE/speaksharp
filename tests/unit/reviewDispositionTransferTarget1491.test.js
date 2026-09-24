import { describe, expect, it } from 'vitest';
import { P2_TRANSFER_TARGETS, REVIEW_DISPOSITION_MARKER, authorizedP2Disposition } from '../../scripts/collect-review-qualification.mjs';

/**
 * PO/PM review protocol (2026-09-24): deferred findings go to the catch-all ledger #1491. An OWNER-authored, exact-head,
 * exact-finding P2 disposition naming #1491 moves that finding to the advisory count; #1399 (historical) still verifies.
 * Everything else stays blocking: other targets, stale heads, other findings, non-owners, Codex, open threads, P0/P1,
 * extra keys, malformed or duplicate markers.
 */
const HEAD = 'a'.repeat(40);
const FINDING = { databaseId: 4095568442 };
const marker = (fields) => `<!-- ${REVIEW_DISPOSITION_MARKER} ${JSON.stringify(fields)} -->`;
const valid = { head: HEAD, findingCommentId: FINDING.databaseId, classification: 'P2', transferTarget: '#1491' };
const reply = (body, extra = {}) => ({ body, authorAssociation: 'OWNER', author: { login: 'relativityE' }, ...extra });
const thread = (comments, isResolved = true) => ({
    isResolved,
    comments: { nodes: [{ databaseId: FINDING.databaseId, body: 'P1 finding', author: { login: 'chatgpt-codex-connector[bot]' }, authorAssociation: 'NONE' }, ...comments] },
});
const check = (t, head = HEAD) => authorizedP2Disposition({ thread: t, finding: FINDING, head });

describe('P2 disposition transfer targets', () => {
    it('accepts #1491 (the current catch-all) and still accepts historical #1399 — nothing else', () => {
        expect(P2_TRANSFER_TARGETS).toEqual(['#1399', '#1491']);
        expect(check(thread([reply(`PM: deferred.\n\n${marker(valid)}`)]))).toBe(true);
        expect(check(thread([reply(marker({ ...valid, transferTarget: '#1399' }))]))).toBe(true);
    });

    it.each([
        ['an arbitrary target', [reply(marker({ ...valid, transferTarget: '#1500' }))], true, HEAD],
        ['a target without the #', [reply(marker({ ...valid, transferTarget: '1491' }))], true, HEAD],
        ['a stale head', [reply(marker({ ...valid, head: 'b'.repeat(40) }))], true, HEAD],
        ['another finding', [reply(marker({ ...valid, findingCommentId: 1 }))], true, HEAD],
        ['a P1 classification', [reply(marker({ ...valid, classification: 'P1' }))], true, HEAD],
        ['an extra key', [reply(marker({ ...valid, fixed: true }))], true, HEAD],
        ['a malformed marker', [reply(`<!-- ${REVIEW_DISPOSITION_MARKER} {"head": -->`)], true, HEAD],
        ['a duplicate marker', [reply(`${marker(valid)}\n${marker(valid)}`)], true, HEAD],
        ['a second, conflicting marker in another reply', [reply(marker(valid)), reply(marker({ ...valid, transferTarget: '#1399' }))], true, HEAD],
        ['a non-owner (MEMBER)', [reply(marker(valid), { authorAssociation: 'MEMBER' })], true, HEAD],
        ['a Codex-authored marker', [reply(marker(valid), { author: { login: 'chatgpt-codex-connector[bot]' } })], true, HEAD],
        ['an UNRESOLVED thread', [reply(marker(valid))], false, HEAD],
    ])('rejects %s — the finding stays blocking', (_label, comments, resolved, head) => {
        expect(check(thread(comments, resolved), head)).toBe(false);
    });
});
