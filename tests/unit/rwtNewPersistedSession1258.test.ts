// @vitest-environment node
/**
 * #1576 Codex P1 4237614257 — a NEW durable save is `data-session-persisted="true"` AND a non-null id distinct from the
 * predecessor. Start clears the attribute, so "not the old id" alone accepts null and the New Set / Edit and switch rows
 * could inspect no take (or a stale one).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNewPersistedSession } from '../live/helpers/rwtOracles';

describe('a new persisted session', () => {
    it('only a persisted, non-null id different from the predecessor counts', () => {
        expect([
            isNewPersistedSession({ persisted: 'true', id: 'b' }, 'a'),
            isNewPersistedSession({ persisted: null, id: null }, 'a'),
            isNewPersistedSession({ persisted: 'true', id: null }, 'a'),
            isNewPersistedSession({ persisted: 'true', id: 'a' }, 'a'),
            isNewPersistedSession({ persisted: 'false', id: 'b' }, 'a'),
            isNewPersistedSession({ persisted: 'true', id: 'b' }, null),
        ]).toEqual([true, false, false, false, false, true]);
    });
    it('the completed-review, New Set / Edit and switch takes wait through it; no null-accepting "not the old id" poll remains', () => {
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(helper.match(/await waitForNewPersistedSession\(page, /g)?.length).toBe(4);
        expect(helper).not.toMatch(/data-session-persisted-id'\)\), \{ timeout: 120_000 \}\)\s*\.not\.toBe/);
        expect(helper).not.toMatch(/expect\.poll\(lastSaved/);
    });
});
