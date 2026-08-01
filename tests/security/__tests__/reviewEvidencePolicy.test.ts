import { describe, expect, it } from 'vitest';
import {
    APPROVED_SCREENSHOT_UPLOADS,
    LEGACY_COMMITTED_REVIEW_BINARIES,
    committedReviewBinaries,
    inventoryArtifactUploads,
    reviewEvidencePolicyViolations,
} from '../../../scripts/check-review-evidence-policy.mjs';

describe('#1132 ephemeral review-evidence policy', () => {
    it('inventories every upload and enforces the repository policy', () => {
        const inventory = inventoryArtifactUploads();

        expect(inventory.length).toBeGreaterThan(40);
        expect(new Set(inventory.map(({ key }) => key)).size).toBe(inventory.length);
        expect(inventory.every(({ workflow, name, paths, retentionDays }) =>
            workflow && name && paths.length > 0 && retentionDays)).toBe(true);
        expect(reviewEvidencePolicyViolations()).toEqual([]);
    });

    it('limits approved screenshot uploaders to PNG-only one-day artifacts', () => {
        const screenshotUploads = inventoryArtifactUploads().filter(({ name, paths }) =>
            /screenshot/i.test(name ?? '') || paths.some((path) => /\.png(?:$|\b)/i.test(path)));

        expect(new Set(screenshotUploads.map(({ key }) => key))).toEqual(APPROVED_SCREENSHOT_UPLOADS);
        expect(screenshotUploads.every(({ retentionDays }) => retentionDays === '1')).toBe(true);
        expect(screenshotUploads.every(({ paths }) => paths.every((path) => /\.png(?:$|\b)/i.test(path)))).toBe(true);
    });

    it('freezes legacy committed review binaries without authorizing deletion or additions', () => {
        expect(new Set(committedReviewBinaries())).toEqual(LEGACY_COMMITTED_REVIEW_BINARIES);
    });
});
