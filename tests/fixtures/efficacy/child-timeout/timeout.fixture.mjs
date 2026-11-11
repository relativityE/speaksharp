import { test } from 'vitest';
import process from 'node:process';
import { URL } from 'node:url';
import { runEfficacyChild } from '../../../helpers/runEfficacyChild.mjs';

test('times out while the coordinator phase is active', async () => {
  await runEfficacyChild(new URL('./coordinator.mjs', import.meta.url).pathname, [], { cwd: process.cwd(), env: process.env });
}, Number(process.env.EFFICACY_TIMEOUT_TEST_MS));
