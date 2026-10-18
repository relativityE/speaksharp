// Private pre-deploy operation; merging this caller requires its explicit release disclosure.
import process from 'node:process';
import console from 'node:console';
import { invalidateAccountClosureBeforeDeployment } from './lib/accountClosureDeploymentGuard.mjs';
const result = await invalidateAccountClosureBeforeDeployment({ url: process.env.SUPABASE_URL,
    projectId: process.env.SUPABASE_PROJECT_ID, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    releaseSha: process.env.GITHUB_SHA });
console.log(JSON.stringify(result));
if (result.status !== 'INVALIDATED') process.exitCode = 1;
