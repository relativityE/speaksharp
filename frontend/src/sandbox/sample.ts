/**
 * Phase 2 SANDBOX sample journey data — a ready-made rehearsal so review needs no setup.
 *
 * Static, in-memory only. The rehearsal timeline is a scripted sequence of transcript segments that
 * "arrive" as the user speaks; the passive agenda rail derives its gray/yellow/green states from these
 * via the merged, local outcomeScorecard (evidence-backed). One point is left un-addressed so the
 * user-requested Help → one remedy → supplement → evidence-backed recovery loop can be shown, and one
 * point is genuinely missed so the "next focus" is real.
 */

import type { RehearsalBrief } from '@/services/rehearsal/rehearsalBrief';
import type { TranscriptSegment } from '@/services/rehearsal/outcomeScorecard';

export interface ScriptedSegment extends TranscriptSegment {
  /** Wall-clock ms after "Start rehearsal" when this segment arrives (drives the passive animation). */
  atMs: number;
}

export const SAMPLE_BRIEF: RehearsalBrief = {
  audience: 'Board of directors',
  objective: 'Get the Q3 plan approved',
  desiredDecision: 'Approve two additional engineering hires and the November billing rollout',
  talkingPoints: [
    'Present our revenue growth of eighteen percent this quarter',
    'Explain the customer retention risk in the enterprise segment',
    'Request approval for two additional engineering hires',
    'Outline the migration timeline for the new billing system',
  ],
};

// Scripted "speaking" (persistent end-states, so the passive rail is screenshot-stable):
//  - item 1 (revenue) becomes covered;
//  - item 2 (retention) becomes partly addressed and STAYS partial;
//  - item 3 (the ask) is left un-addressed for the user-requested Help → recovery loop;
//  - item 4 (migration) is genuinely missed → the next-run focus.
export const SAMPLE_TIMELINE: ScriptedSegment[] = [
  { atMs: 2200, startSec: 4, text: "I'll present our revenue growth of eighteen percent this quarter" },
  { atMs: 4200, startSec: 22, text: 'there is a retention risk in our enterprise segment we should watch' },
];

// The one concise remedy offered when the user asks for help on the un-addressed ask (point index 2).
export const SAMPLE_REMEDY = {
  pointIndex: 2,
  text: 'State the ask out loud — name the exact decision you need from the board.',
  // What the user says after the remedy (the supplement that proves recovery).
  supplement: { startSec: 78, text: 'To be clear, I am requesting approval for two additional engineering hires' } as TranscriptSegment,
};

// The genuinely-missed point → next-run focus.
export const SAMPLE_NEXT_FOCUS_INDEX = 3;

/**
 * General-practice (no agenda) delivery samples for the Finish screen. Raw movement leads; the
 * percentage is secondary. `firstSession` shows the baseline-established state (no comparison yet).
 */
export interface DeliverySample {
  firstSession: boolean;
  metrics: {
    key: string;
    label: string;
    unit: string;
    fixedBaseline: number;
    previous?: number;
    current: number;
    target: { kind: 'lowerThreshold'; threshold: number } | { kind: 'range'; lo: number; hi: number };
    eligible: boolean;
    ineligibleReason?: string;
  }[];
}

export const GENERAL_IMPROVED: DeliverySample = {
  firstSession: false,
  metrics: [
    { key: 'fillers', label: 'Filler words', unit: '/min', fixedBaseline: 8, previous: 6, current: 5, target: { kind: 'lowerThreshold', threshold: 2 }, eligible: true },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', fixedBaseline: 180, previous: 168, current: 148, target: { kind: 'range', lo: 130, hi: 150 }, eligible: true },
    { key: 'clarity', label: 'Clarity', unit: '', fixedBaseline: 62, previous: 68, current: 71, target: { kind: 'lowerThreshold', threshold: 2 }, eligible: false, ineligibleReason: 'Shown as raw direction only — clarity is not yet a validated, comparable target.' },
  ],
};

export const GENERAL_BASELINE: DeliverySample = {
  firstSession: true,
  metrics: [
    { key: 'fillers', label: 'Filler words', unit: '/min', fixedBaseline: 7.4, current: 7.4, target: { kind: 'lowerThreshold', threshold: 2 }, eligible: true },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', fixedBaseline: 182, current: 182, target: { kind: 'range', lo: 130, hi: 150 }, eligible: true },
  ],
};
