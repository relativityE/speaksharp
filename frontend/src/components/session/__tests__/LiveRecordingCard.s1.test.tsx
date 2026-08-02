import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';

// #1120 S1 — with the hierarchy flag ON: Private is primary/recommended, Browser is the secondary
// fallback, and Cloud is customer-invisible (row + About entry not rendered — never merely disabled).
vi.mock('@/config/sttHierarchyFlags', () => ({
    isPrivatePrimaryEnabled: () => true,
    isCloudSttGloballyVisible: () => false,
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
});
