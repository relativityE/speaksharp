import fs from "fs";
import path from "path";

export default class TelemetryReporter {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      tests: []
    };
  }

  onTestEnd(test, result) {
    const title = test.titlePath().join(" › ");
    const outcome = test.outcome();
    
    const entry = {
      title,
      status: result.status,
      outcome: outcome,
      retries: result.retry,
      duration: result.duration
    };

    this.results.tests.push(entry);

    switch (outcome) {
      case "expected":
        this.results.passed++;
        break;

      case "flaky":
        this.results.flaky++;
        console.log(`[PW][FLAKY] ${title} (retry ${result.retry})`);
        break;

      case "unexpected":
        this.results.failed++;
        console.log(`[PW][${result.status.toUpperCase()}] ${title}`);
        if (result.error?.message) {
          const cleanMsg = (result.error.message || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
          console.log(`[PW][ERROR] ${cleanMsg}`);
        }
        break;

      case "skipped":
        this.results.skipped++;
        break;
    }
  }

  onEnd() {
    const rootDir = process.cwd();
    const telemetryPath = path.join(rootDir, "test-results", "playwright-results.json");

    fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });

    fs.writeFileSync(
      telemetryPath,
      JSON.stringify(this.results, null, 2)
    );

    console.log(
      `[PW] Summary: ${this.results.passed} passed, ` +
      `${this.results.failed} failed, ` +
      `${this.results.flaky} flaky`
    );
  }
}
