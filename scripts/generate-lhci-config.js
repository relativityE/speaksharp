import { PORTS } from './build.config.js';
import fs from 'fs';
import path from 'path';

const config = {
    ci: {
        collect: {
            startServerCommand: `pnpm preview --port ${PORTS.PREVIEW}`,
            url: [`http://localhost:${PORTS.PREVIEW}/`],
            numberOfRuns: 3,
            settings: {
                preset: 'desktop',
            },
        },
        assert: {
            assertions: {
                'categories:performance': ['error', { minScore: 0.9 }],
                'categories:accessibility': ['error', { minScore: 0.9 }],
                'categories:best-practices': ['warn', { minScore: 0.75 }],
                'categories:seo': ['error', { minScore: 0.9 }],
            },
        },
        upload: {
            target: 'filesystem',
            outputDir: './.lighthouseci',
            reportFilenamePattern: '%%PATHNAME%%-%%DATETIME%%-report.%%EXTENSION%%',
        },
    },
};

fs.writeFileSync(
    path.resolve(process.cwd(), 'lighthouserc.json'),
    JSON.stringify(config, null, 2)
);

console.log('✅ Generated lighthouserc.json with port', PORTS.PREVIEW);
