// Existing focused tests only; no replacement test framework or product configuration.
import path from 'node:path';
const root=path.resolve(process.env.PM_EVAL_SOURCE||'artifacts/pm-evaluator-6185-source');
export default {resolve:{alias:{'@':path.join(root,'frontend/src')}},test:{root,environment:'node',coverage:{enabled:false},maxWorkers:1,testTimeout:30000,include:['tests/evidence/**/*.test.ts']}};
