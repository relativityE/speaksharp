// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

const fixtureFile = 'tests/live/helpers/deployedCoachingContract.json';
const fixturePath = path.resolve(fixtureFile);
const bytes = readFileSync(fixturePath, 'utf8');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const readback = {
  sessionId: 'a', userId: 'owner', product: 'open_mic' as const,
  transcript: 'A concrete statement.',
  metrics: { wpm: 120, filler_counts: {}, filler_words: null, next_action_signal: null },
  promptContext: { transcriptState: 'available' as const, focusContext: { kind: 'none' as const } },
};

async function consume(replacement?: string) {
  const reads: string[] = [];
  vi.resetModules();
  vi.doMock('node:fs', async (original) => {
    const fs = await original<typeof import('node:fs')>();
    return { ...fs, readFileSync: (...args: Parameters<typeof readFileSync>) => {
      if (path.resolve(String(args[0])) === fixturePath) {
        reads.push(fixtureFile);
        if (replacement !== undefined) return replacement;
      }
      return Reflect.apply(fs.readFileSync, fs, args);
    } };
  });
  try {
    const consistency = await import('../live/helpers/rwtCoachingConsistency');
    const evidence = await import('../live/helpers/rwtCoachingEvidence');
    return {
      reads,
      ceiling: consistency.COACHING_CHARACTER_CEILING,
      ceilingVerdict: consistency.characterCeilingVerdict('x'.repeat(240), 'y'.repeat(240)).status,
      model: evidence.coachingContract.model,
      promptHash: evidence.recomputeCoachingPromptSha256(readback),
    };
  } finally {
    vi.doUnmock('node:fs');
    vi.resetModules();
  }
}

it('deployed coaching fixture drives both actual readers and rejects changed input', async () => {
  const positive = await consume();
  expect(positive.reads).toEqual([fixtureFile, fixtureFile]);
  expect(positive.ceiling).toEqual({ what_worked: 240, what_to_try_next: 240 });
  expect(positive.ceilingVerdict).toBe('PASS');
  expect(positive.model).toBe('gemini-3.6-flash');
  expect(positive.promptHash).toMatch(/^[a-f0-9]{64}$/);

  const shortened = JSON.parse(bytes);
  shortened.generationConfig.responseSchema.properties.what_worked.maxLength = 239;
  const ceilingNegative = await consume(JSON.stringify(shortened));
  expect(ceilingNegative.ceilingVerdict).toBe('FAIL');
  const changedPrompt = JSON.parse(bytes);
  changedPrompt.promptTemplate += '\nA different instruction.';
  const promptNegative = await consume(JSON.stringify(changedPrompt));
  expect(promptNegative.promptHash).not.toBe(positive.promptHash);
  await expect(consume('{')).rejects.toThrow();

  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING || 'null');
  if (binding?.fixture?.fixtureFile === fixtureFile) {
    writeFileSync(binding.fixture.witnessFile, JSON.stringify({
      schemaVersion: 3, phaseId: binding.phaseId, bindingSha256: sha(JSON.stringify(binding)),
      fixtureFile, fixtureSha256: sha(bytes),
      assertion: 'deployed coaching fixture drives both actual readers and rejects changed input',
      positive, ceilingNegative: ceilingNegative.ceilingVerdict,
      promptNegative: promptNegative.promptHash, malformedRejected: true,
    }));
  }
});
