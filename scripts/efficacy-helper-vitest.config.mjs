import path from 'node:path';
import fs from 'node:fs';
import base from '../frontend/vitest.config.mjs';
import {helperCoverageOptions} from './lib/helperExecutionEvidence.mjs';

const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING || 'null');
const root = path.resolve(process.cwd());
const output = binding?.coverageDirectory;
if (!output || path.dirname(output) !== root || !path.basename(output).startsWith('.helper-coverage-')
  || fs.realpathSync(output) !== output || fs.readdirSync(output).length !== 0) {
  throw new Error('Helper coverage requires a fresh empty unique phase directory');
}
const setup = (base.test.setupFiles || []).map(file => path.relative(root,file));
if (JSON.stringify(setup) !== JSON.stringify(binding.helper.sourceBinding.setupFiles)) {
  throw new Error('Unsupported helper base setup configuration');
}
export default {
  ...base,
  test: {...base.test, root, include: [binding.helper.testFile], fileParallelism: false, maxWorkers: 1, minWorkers: 1,
    coverage: helperCoverageOptions(root, binding)},
};
