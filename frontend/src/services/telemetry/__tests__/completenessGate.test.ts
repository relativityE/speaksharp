import { describe, it, expect } from 'vitest';
import { evaluateTelemetryCompleteness, REQUIRED_EVENT_FAMILIES } from '../completenessGate';
import { GOVERNED_EVENTS } from '../../telemetryAllowlist';

const complete = () => [...REQUIRED_EVENT_FAMILIES];

describe('#1259 — a readback that finds nothing must HOLD, not pass', () => {
    it('QUALIFIES only when every required family was actually observed', () => {
        expect(evaluateTelemetryCompleteness(complete()).verdict).toBe('QUALIFIED');
    });

    it('CASUALTY: each required family, removed alone, HOLDS', () => {
        // One assertion per family, because a gate that only rejects the absence of everything is not a
        // gate — the realistic failure is exactly one producer having gone silent.
        for (const family of REQUIRED_EVENT_FAMILIES) {
            const observed = complete().filter((n) => n !== family);
            const result = evaluateTelemetryCompleteness(observed);
            expect(result.verdict).toBe('HOLD');
            expect(result.missing).toEqual([family]);
            expect(result.reasons.join(' ')).toContain(family);
        }
    });

    it('CASUALTY: an empty readback HOLDS and names everything it wanted', () => {
        // The shape that matters most: a run where the transport never worked. It must not read as a
        // clean run with nothing to report.
        const result = evaluateTelemetryCompleteness([]);
        expect(result.verdict).toBe('HOLD');
        expect(result.missing).toEqual([...REQUIRED_EVENT_FAMILIES]);
    });

    it('CASUALTY: junk input HOLDS rather than coercing to fine', () => {
        for (const input of [null, undefined, {}, 'session_started', 0, false]) {
            expect({ input, verdict: evaluateTelemetryCompleteness(input).verdict }).toEqual({ input, verdict: 'HOLD' });
        }
        // Non-string entries are not sightings, and the result says so rather than silently tidying.
        const mixed = evaluateTelemetryCompleteness([...complete(), 42, null]);
        expect(mixed.verdict).toBe('HOLD');
        expect(mixed.reasons.join(' ')).toContain('non-string');
    });

    it('CASUALTY: a name outside the governed allowlist HOLDS the whole run', () => {
        // Decoder and allowlist disagreeing makes every other conclusion from this readback suspect,
        // including the ones that looked fine.
        const result = evaluateTelemetryCompleteness([...complete(), 'transcript_text_leak']);
        expect(result.verdict).toBe('HOLD');
        expect(result.unrecognised).toEqual(['transcript_text_leak']);
    });

    it('every required family is a real governed event — the gate cannot demand something unproducible', () => {
        // A typo here would make qualification permanently impossible and look like a telemetry outage.
        for (const family of REQUIRED_EVENT_FAMILIES) {
            expect({ family, governed: GOVERNED_EVENTS.includes(family) }).toEqual({ family, governed: true });
        }
    });

    it('duplicates and ordering do not change the verdict', () => {
        const noisy = [...complete(), ...complete()].reverse();
        expect(evaluateTelemetryCompleteness(noisy).verdict).toBe('QUALIFIED');
    });
});
