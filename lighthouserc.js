import { PORTS } from './scripts/build.config.js';

export default {
    ci: {
        collect: {
            staticDistDir: './frontend/dist',
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
                'categories:best-practices': ['error', { minScore: 0.9 }],
                'categories:seo': ['error', { minScore: 0.9 }],
            },
        },
        upload: {
            target: 'temporary-public-storage',
        },
    },
};
