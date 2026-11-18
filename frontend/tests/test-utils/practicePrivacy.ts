/**
 * #1835 test helper: puts the practice privacy store in a recorded-choice state for one owner, so suites written before
 * the opt-in exercise the path they were written for. The default is saving and AI coaching ON (the pre-#1835 behaviour);
 * suites about the opt-in itself set the state they test.
 */
import { resetPracticePrivacyForTests, usePracticePrivacyStore } from '@/services/practicePrivacy';

export const TEST_PRIVACY_OWNER = '00000000-0000-4000-8000-0000000000aa';

export function grantPracticePrivacy(
  { transcriptSave = true, aiCoaching = true, ownerId = TEST_PRIVACY_OWNER, revision = 1 }:
  { transcriptSave?: boolean; aiCoaching?: boolean; ownerId?: string; revision?: number } = {},
): void {
  resetPracticePrivacyForTests();
  usePracticePrivacyStore.setState({ ownerId, status: 'chosen', transcriptSave, aiCoaching: transcriptSave && aiCoaching, revision });
}

export { resetPracticePrivacyForTests };
