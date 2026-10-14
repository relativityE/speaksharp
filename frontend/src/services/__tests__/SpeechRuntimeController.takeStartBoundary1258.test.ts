// @vitest-environment node
/**
 * #1258 (Codex P1 r4273828969, PM 6174115505) — SOURCE CONTRACT for the take-start boundary.
 *
 * The boundary a "Practice this next" acceptance is compared with is when the take's RECORDING began. Both places that
 * create a take's session record it: the Start-time placeholder save captures the time BEFORE creating the row, and a
 * take saved only at Stop records its own recording start. Every completion path (normal Stop, attribution retry, full
 * save retry) reaches the seam through `completeProgressForRecording`, which passes the remembered start — or null.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(path.resolve(__dirname, '../SpeechRuntimeController.ts'), 'utf8');

describe('#1258 — the take-start boundary is captured where each take\'s session is created', () => {
    it('Start-time placeholder save: the SERVICE\'s own recording start (Codex P1 r4275389946), remembered against the new session id', () => {
        const capture = src.indexOf('const serviceStartedAtMs = service.getStartTime();');
        const save = src.indexOf('const saveResult = await saveSession(', capture);
        expect(capture).toBeGreaterThan(-1);
        expect(save).toBeGreaterThan(capture);
        expect(src).toContain('const takeStartedAtIso = serviceStartedAtMs ? new Date(serviceStartedAtMs).toISOString() : null;');
        expect(src.indexOf('if (takeStartedAtIso) this.rememberTakeStart(dbSession.id, takeStartedAtIso);')).toBeGreaterThan(save);
        // Never sampled late, after RECORDING was confirmed and the invariant check awaited.
        expect(src).not.toContain('const takeStartedAtIso = new Date().toISOString();');
    });
    it('a take saved only at Stop remembers its own recording start', () => {
        expect(src).toContain('if (startTime) this.rememberTakeStart(sessionId, new Date(startTime).toISOString());');
    });
    it('the seam receives the remembered start or null — never a guessed stamp', () => {
        expect(src).toContain('takeStartedAtIso: this.takeStartedAtBySession?.get(sessionId) ?? null,');
    });
    it('every completion path goes through completeProgressForRecording (normal Stop, attribution retry, full-save retry)', () => {
        expect(src.match(/await this\.completeProgressForRecording\(/g)?.length).toBe(3);
        expect(src.match(/wireProgressEvaluationOnSave\(\{/g)?.length).toBe(1);
    });
});
