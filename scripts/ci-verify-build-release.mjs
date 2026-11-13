// #1837 (Sam): the build that full-evidence tests must be this commit's, whether it was built fresh or reused from
// main and rebound. Each entry page carries exactly one release marker, and it names this commit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyBuildRelease } from './ci-build-inputs.mjs';

const [dist = 'frontend/dist'] = process.argv.slice(2), sha = process.env.GITHUB_SHA ?? '';
try {
  verifyBuildRelease(Object.fromEntries(['index.html', 'private-dropin.html'].map((p) => [p, readFileSync(join(dist, p), 'utf8')])), sha);
  console.log(`The build under test is release ${sha}.`);
} catch (error) {
  console.log(`::error::The build under test is not release ${sha || '(no GITHUB_SHA)'} (${error.code ?? error.message}).`);
  process.exit(1);
}
