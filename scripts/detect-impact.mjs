import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function run() {
    const mapPath = path.join(rootDir, 'test-impact-map.json');
    if (!fs.existsSync(mapPath)) {
        console.log("ALL");
        return;
    }

    const mapFile = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const baseBranch = process.env.GITHUB_BASE_REF || 'main';

    let changedFiles = [];
    try {
        // Try to get diff from base branch if in a PR
        if (process.env.GITHUB_BASE_REF) {
            changedFiles = execSync(`git diff --name-only origin/${baseBranch}...HEAD`, { cwd: rootDir }).toString().split('\n');
        } else {
            // Fallback to local uncommitted + last commit
            changedFiles = execSync(`git diff --name-only HEAD~1`, { cwd: rootDir }).toString().split('\n');
        }
    } catch (e) {
        // Fallback if git fails
        console.log("ALL");
        return;
    }

    changedFiles = changedFiles.filter(Boolean);

    let testsToRun = new Set();
    let runAll = false;

    for (const file of changedFiles) {
        // If core config changes, run everything
        if (file.match(/package\.json|vite\.config.*|playwright\.config.*|\.github\//)) {
            runAll = true;
            break;
        }

        // Check exact matches or path prefixes
        for (const [sourcePath, tests] of Object.entries(mapFile)) {
            if (file.startsWith(sourcePath) || file === sourcePath) {
                tests.forEach(t => testsToRun.add(t));
            }
        }

        // Auto-detect spec files that changed
        if (file.endsWith('.spec.ts') || file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
            testsToRun.add(file);
        }
    }

    if (runAll) {
        console.log("ALL");
    } else if (testsToRun.size === 0) {
        console.log("NONE");
    } else {
        console.log(Array.from(testsToRun).join(' '));
    }
}

run();
