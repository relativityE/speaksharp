import { afterEach, expect, it } from 'vitest';
import { coachingAllowed, usePracticePrivacyStore } from '@/services/practicePrivacy';
import { grantPracticePrivacy, resetPracticePrivacyForTests, TEST_PRIVACY_OWNER } from '../../frontend/tests/test-utils/practicePrivacy';

afterEach(resetPracticePrivacyForTests);

it('the chosen fixture binds the default grant to one owner and revision', () => {
    grantPracticePrivacy();
    expect(usePracticePrivacyStore.getState()).toMatchObject({
        ownerId: TEST_PRIVACY_OWNER, status: 'chosen', revision: 1,
        transcriptSave: true, aiCoaching: true,
    });
    expect(coachingAllowed()).toBe(true);
});

it('the fixture does not grant coaching without saving or inherit the previous owner', () => {
    grantPracticePrivacy();
    grantPracticePrivacy({ ownerId: 'fixture-next-owner', revision: 3, transcriptSave: false, aiCoaching: true });
    expect(usePracticePrivacyStore.getState()).toMatchObject({
        ownerId: 'fixture-next-owner', revision: 3, transcriptSave: false, aiCoaching: false,
    });
    expect(coachingAllowed()).toBe(false);
});
