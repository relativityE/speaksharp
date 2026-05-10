import fs from 'fs';
import path from 'path';

const outputDir = 'artifacts';
const outputPath = path.join(outputDir, 'ci-job-timing.json');
const runId = process.env.GITHUB_RUN_ID;
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

const ms = (start, end) => {
  if (!start || !end) return 0;
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
};

const fmt = (durationMs) => {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const loadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const flattenSpecs = (suite, prefix = []) => {
  const title = suite.title ? [...prefix, suite.title] : prefix;
  const specs = (suite.specs || []).map((spec) => ({ ...spec, titlePath: title }));
  return [
    ...specs,
    ...(suite.suites || []).flatMap((child) => flattenSpecs(child, title)),
  ];
};

const collectPlaywrightFailures = () => {
  const results = loadJson('test-results/playwright/results.json');
  if (!results?.suites) return [];

  return results.suites
    .flatMap((suite) => flattenSpecs(suite))
    .flatMap((spec) => (spec.tests || []).map((test) => ({ spec, test })))
    .filter(({ test }) => test.status === 'unexpected' || (test.results || []).some((r) => r.status === 'failed' || r.status === 'timedOut'))
    .map(({ spec, test }) => {
      const failedResult = (test.results || []).find((r) => r.status === 'failed' || r.status === 'timedOut') || test.results?.[0] || {};
      const shard = failedResult.workerIndex != null ? `worker-${failedResult.workerIndex}` : 'unknown shard';
      return {
        shard,
        file: spec.file,
        title: [...(spec.titlePath || []), spec.title].filter(Boolean).join(' › '),
        status: test.status,
        error: failedResult.error?.message?.split('\n')[0] || '',
      };
    });
};

const readLocalWallClock = () => {
  if (!fs.existsSync(outputDir)) return [];
  const files = fs.readdirSync(outputDir)
    .filter((file) => /^ci-wall-clock(?:-shard-\d+)?\.json$/.test(file));

  return files.flatMap((file) => {
    const data = loadJson(path.join(outputDir, file));
    if (!data) return [];
    const shard = file.match(/shard-(\d+)/)?.[1] || null;
    const stages = (data.stages || []).map((stage) => ({
      name: shard ? `local-shard-${shard}:${stage.stage}` : `local:${stage.stage}`,
      durationMs: stage.duration || 0,
      steps: (stage.subtasks || []).map((subtask) => ({
        name: subtask.name,
        status: 'completed',
        conclusion: 'local',
        durationMs: subtask.duration || 0,
      })),
    }));
    return [
      {
        name: shard ? `local-shard-${shard}` : 'local-ci',
        status: 'completed',
        conclusion: data.status || 'local',
        durationMs: data.actualWallClockMs || data.totalDurationMs || stages.reduce((sum, stage) => sum + stage.durationMs, 0),
        steps: stages.map((stage) => ({
          name: stage.name,
          status: 'completed',
          conclusion: 'local',
          durationMs: stage.durationMs,
        })),
      },
    ];
  });
};

const fetchJobs = async () => {
  if (!runId || !repo || !token) return [];
  const jobs = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) {
      console.warn(`[CI TIMING] GitHub jobs API returned ${response.status}`);
      return jobs;
    }
    const data = await response.json();
    jobs.push(...(data.jobs || []));
    if (!data.jobs || data.jobs.length < 100) return jobs;
    page += 1;
  }
};

const main = async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const jobs = await fetchJobs();
  const jobSummaries = jobs.length > 0 ? jobs.map((job) => ({
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    durationMs: ms(job.started_at, job.completed_at),
    steps: (job.steps || []).map((step) => ({
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
      durationMs: ms(step.started_at, step.completed_at),
    })),
  })) : readLocalWallClock();

  const allSteps = jobSummaries.flatMap((job) => job.steps.map((step) => ({
    job: job.name,
    ...step,
  })));
  const slowestJob = [...jobSummaries].sort((a, b) => b.durationMs - a.durationMs)[0] || null;
  const slowestStep = [...allSteps].sort((a, b) => b.durationMs - a.durationMs)[0] || null;
  const shardDurations = jobSummaries
    .filter((job) => /^e2e-shard-\d+$/.test(job.name))
    .map((job) => ({ shard: job.name.replace('e2e-shard-', ''), durationMs: job.durationMs, conclusion: job.conclusion }));
  const failures = collectPlaywrightFailures();

  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    slowestJob,
    slowestStep,
    shardDurations,
    jobs: jobSummaries,
    failures,
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              CI ACTIONS TIMING + FAILURE SUMMARY           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  if (slowestJob) console.log(`  Slowest job  : ${slowestJob.name} (${fmt(slowestJob.durationMs)})`);
  if (slowestStep) console.log(`  Slowest step : ${slowestStep.job} / ${slowestStep.name} (${fmt(slowestStep.durationMs)})`);
  if (shardDurations.length > 0) {
    console.log('  Shards       :');
    shardDurations.forEach((shard) => {
      console.log(`    - shard ${shard.shard}: ${fmt(shard.durationMs)} (${shard.conclusion || 'running'})`);
    });
  }
  if (failures.length > 0) {
    console.log('  Failures     :');
    failures.slice(0, 10).forEach((failure) => {
      console.log(`    - failed because ${failure.shard} / ${failure.file}: ${failure.title}`);
      if (failure.error) console.log(`      ${failure.error}`);
    });
  } else {
    console.log('  Failures     : none found in merged Playwright report');
  }
  console.log('');
};

main().catch((error) => {
  console.warn(`[CI TIMING] Failed to generate timing summary: ${error.message}`);
});
