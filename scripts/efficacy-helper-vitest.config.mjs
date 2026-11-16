import path from 'node:path';
import fs from 'node:fs';
import {transformWithEsbuild} from 'vite';
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
  plugins: [...(base.plugins || []), {
    name: 'helper-mjs-source-map', enforce: 'pre',
    transform(code, id) {
      if (!binding.helper.helperFile.endsWith('.mjs') || id.split('?')[0] !== path.join(root, binding.helper.helperFile)) return null;
      return transformWithEsbuild(code, id, {loader: 'js', sourcemap: true, target: 'esnext'});
    },
  }],
  test: {...base.test, root, include: [binding.helper.testFile], fileParallelism: false, maxWorkers: 1, minWorkers: 1,
    coverage: helperCoverageOptions(root, binding)},
};
