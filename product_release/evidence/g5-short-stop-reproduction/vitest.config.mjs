import original from '../../../frontend/vitest.config.mjs';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
export default {
  ...original,
  test: {
    ...original.test,
    include: [`${directory}shortTake.probe.ts`],
    silent: false,
    // Standalone diagnostic, not release evidence or a replacement for coverage gates.
    coverage: { enabled: false },
  },
};
