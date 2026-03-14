import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Automates test impact detection using dependency-cruiser.
 * Replaces manual test-impact-map.json.
 */
async function run() {
    try {
        const baseBranch = process.env.GITHUB_BASE_REF || 'main';
        let changedFiles = [];

        try {
            if (process.env.GITHUB_BASE_REF) {
                changedFiles = execSync(`git diff --name-only origin/${baseBranch}...HEAD`, { cwd: rootDir }).toString().split('\n');
            } else {
                changedFiles = execSync(`git diff --name-only HEAD~1`, { cwd: rootDir }).toString().split('\n');
            }
        } catch (e) {
            console.log("ALL");
            return;
        }

        changedFiles = changedFiles.filter(Boolean);

        // Optimization: If core config or infra changes, run everything
        const runAllPattern = /package\.json|vite\.config.*|playwright\.config.*|\.dependency-cruiser\.cjs|tsconfig\.json|\.github\//;
        if (changedFiles.some(f => f.match(runAllPattern))) {
            console.log("ALL");
            return;
        }

        // Generate full dependency graph as JSON
        // Using --includeOnly to focus on src and tests
        const cruiseOutput = execSync('npx depcruise frontend/src --config .dependency-cruiser.cjs --output-type json', { cwd: rootDir }).toString();
        const graph = JSON.parse(cruiseOutput);

        const modules = graph.modules;
        const testsToRun = new Set();

        // Build a Map of file -> its dependents (reverse graph)
        const reverseGraph = new Map();
        for (const module of modules) {
            const fileName = module.source;
            for (const dep of module.dependencies) {
                const depName = dep.resolved;
                if (!reverseGraph.has(depName)) reverseGraph.set(depName, new Set());
                reverseGraph.get(depName).add(fileName);
            }
        }

        // Helper: Find all transitive dependents
        const visited = new Set();
        function findDependents(file) {
            if (visited.has(file)) return;
            visited.add(file);

            // If it's a test file, add it to the set
            if (file.match(/\.(spec|test)\.(ts|tsx|js)$/)) {
                testsToRun.add(file);
            }

            const dependents = reverseGraph.get(file);
            if (dependents) {
                for (const dependent of dependents) {
                    findDependents(dependent);
                }
            }
        }

        // Process each changed file
        for (const file of changedFiles) {
            // Auto-detect spec files that changed directly
            if (file.match(/\.(spec|test)\.(ts|tsx|js)$/)) {
                testsToRun.add(file);
                continue;
            }

            // Otherwise find what depends on it
            findDependents(file);
        }

        if (testsToRun.size === 0) {
            console.log("NONE");
        } else {
            console.log(Array.from(testsToRun).join(' '));
        }

    } catch (error) {
        console.error("Error in impact detection:", error);
        console.log("ALL"); // Fallback to safe mode
    }
}

run();
