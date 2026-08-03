import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';

// #1120 S1 — with the hierarchy flag ON: Private is primary/recommended, Browser is the secondary
// fallback, and Cloud is customer-invisible (row + About entry not rendered — never merely disabled).
vi.mock('@/config/sttHierarchyFlags', () => ({
    isPrivatePrimaryEnabled: () => true,
    isCloudSttEnabled: () => false,         // S1: Cloud globally off + invisible
    isCloudSttGloballyVisible: () => false,
    resolveDefaultSttMode: (p: boolean, c: boolean) => (p && c ? 'private' : 'native'),
    sttFlagsReadyInitial: () => true,
    onSttFlagsReady: () => () => {},
    STT_HIERARCHY_FLAG_KEY: 'stt_private_primary_v1',
    CLOUD_STT_FLAG_KEY: 'cloud_stt_enabled',
}));

describe('#1120 S1 LiveRecordingCard — Private primary, Cloud invisible (flag ON)', () => {
    const props = {
        mode: 'private' as const,
        isListening: false,
        isReady: true,
        canUsePrivate: true,
        isPaidProUser: true,
        canUseCloudStt: true, // even if entitled, S1 hides Cloud entirely
        formattedTime: '00:00',
        elapsedSeconds: 0,
        isButtonDisabled: false,
        activeEngine: null as 'native' | 'cloud' | 'private' | 'none' | null,
        onModeChange: vi.fn(),
        onStartStop: vi.fn(),
    };

    beforeEach(() => vi.clearAllMocks());

    it('hides the Cloud option row and the About-Cloud entry entirely', async () => {
        render(<LiveRecordingCard {...props} />);
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        // Private and Browser remain; Cloud is gone (not merely disabled).
        expect(await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.STT_MODE_NATIVE)).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.STT_MODE_CLOUD)).toBeNull();
        expect(screen.queryByTestId('stt-about-cloud')).toBeNull();
    });

    it('marks Private as the recommended primary; Browser stays the labelled secondary', async () => {
        render(<LiveRecordingCard {...props} />);
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        expect(await screen.findByTestId('stt-mode-tag-recommended')).toBeInTheDocument();
        // Browser is still present and still labelled "Browser" (never "Native"), as the secondary fallback.
        expect(screen.getByTestId(TEST_IDS.STT_MODE_NATIVE)).toHaveTextContent(/Browser/);
        expect(screen.getByTestId(TEST_IDS.STT_MODE_NATIVE)).not.toHaveTextContent(/Native/);
    });

    // #1120 S1 (accepted item 5) — STATIC CUSTOMER-SURFACE CONTRACT for the STT selector surface.
    // In the launch state the entire rendered selector — option labels, badges, the About panel, and the
    // sr-only accessibility descriptors — must carry NO ordinary "Cloud" option/value copy and NO current
    // "Native" customer label. (Pricing/Auth surfaces are covered by their own Cloud-absence tests.)
    it('carries no customer-facing "Cloud" copy or "Native" label anywhere in the selector + accessibility text', async () => {
        const { container } = render(<LiveRecordingCard {...props} />);
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE);

        // Visible text + sr-only descriptors are all part of textContent.
        const surfaceText = `${container.textContent ?? ''} ${document.body.textContent ?? ''}`;
        expect(surfaceText).not.toMatch(/\bcloud\b/i);
        expect(surfaceText).not.toMatch(/\bnative\b/i);
        // The approved customer vocabulary IS present (labels can be adjacent to badges in textContent, so
        // match the words without requiring surrounding whitespace boundaries).
        expect(surfaceText).toMatch(/browser/i);
        expect(surfaceText).toMatch(/private/i);

        // Accessibility descriptors specifically: present, and free of the forbidden terms.
        const nativeDesc = document.getElementById('stt-native-descriptor');
        const privateDesc = document.getElementById('stt-private-descriptor');
        expect(nativeDesc?.textContent ?? '').not.toMatch(/\b(cloud|native)\b/i);
        expect(privateDesc?.textContent ?? '').not.toMatch(/\b(cloud|native)\b/i);
    });
});
