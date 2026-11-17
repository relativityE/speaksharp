/**
 * #1835 — the Practice prompt (S1 new / S2 returning) and Account → Privacy & data (S6, S7).
 * Nothing is preselected; AI coaching needs saving; Continue records both answers through the one RPC; a switch never
 * deletes anything, and stopping saving asks first because it turns AI coaching off too.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '../../../../tests/support/test-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { usePracticePrivacyStore } from '@/services/practicePrivacy';
import { PracticePrivacyPrompt } from '../PracticePrivacyPrompt';
import { PrivacySettingsCard } from '../PrivacySettingsCard';
import { PRIVACY_PROMPT_COPY, PRIVACY_SETTINGS_COPY } from '../privacyCopy';
import { grantPracticePrivacy, resetPracticePrivacyForTests, TEST_PRIVACY_OWNER } from '../../../../tests/test-utils/practicePrivacy';

vi.mock('@/lib/supabaseClient');

const client = { rpc: vi.fn(), from: vi.fn() };
const row = (save: boolean, ai: boolean, revision = 1) => ({ transcript_save: save, ai_coaching: ai, consent_version: 1, choice_revision: revision });

function unknownOwner() {
    resetPracticePrivacyForTests();
    usePracticePrivacyStore.setState({ ownerId: TEST_PRIVACY_OWNER, status: 'unknown' });
}

beforeEach(() => {
    vi.clearAllMocks();
    client.rpc.mockReset();
    client.from.mockReset();
    client.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
    vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as SupabaseClient);
});
afterEach(() => resetPracticePrivacyForTests());

describe('PracticePrivacyPrompt', () => {
    it('new user (S1): nothing is preselected and Continue waits for both answers', () => {
        unknownOwner();
        render(<PracticePrivacyPrompt returning={false} />);
        expect(screen.getByTestId('practice-privacy-prompt')).toHaveAttribute('data-variant', 'new');
        expect(screen.getByText(PRIVACY_PROMPT_COPY.newTitle)).toBeInTheDocument();
        for (const id of ['privacy-save-yes', 'privacy-save-no', 'privacy-ai-yes', 'privacy-ai-no']) {
            expect(screen.getByTestId(id)).toHaveAttribute('aria-checked', 'false');
        }
        expect(screen.getByTestId('privacy-continue')).toBeDisabled();
        expect(screen.getByTestId('privacy-continue-reason')).toHaveTextContent(PRIVACY_PROMPT_COPY.continueReason);
        fireEvent.click(screen.getByTestId('privacy-save-yes'));
        expect(screen.getByTestId('privacy-continue')).toBeDisabled();
        fireEvent.click(screen.getByTestId('privacy-ai-no'));
        expect(screen.getByTestId('privacy-continue')).toBeEnabled();
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('returning user (S2): says coaching is paused and that past data stays as it is', () => {
        unknownOwner();
        render(<PracticePrivacyPrompt returning />);
        expect(screen.getByTestId('practice-privacy-prompt')).toHaveAttribute('data-variant', 'returning');
        expect(screen.getByText(PRIVACY_PROMPT_COPY.returningIntro)).toBeInTheDocument();
        expect(screen.getByText(PRIVACY_PROMPT_COPY.returningFooter)).toBeInTheDocument();
    });

    it('"Don\'t save" makes both AI options unavailable with the reason, and settles the AI answer as off', () => {
        unknownOwner();
        render(<PracticePrivacyPrompt returning={false} />);
        fireEvent.click(screen.getByTestId('privacy-ai-yes'));
        fireEvent.click(screen.getByTestId('privacy-save-no'));
        expect(screen.getByTestId('privacy-ai-needs-save')).toHaveTextContent(PRIVACY_PROMPT_COPY.aiNeedsSave);
        expect(screen.getByTestId('privacy-ai-yes')).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByTestId('privacy-ai-yes')).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByTestId('privacy-ai-yes'));
        expect(screen.getByTestId('privacy-ai-yes')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('privacy-continue')).toBeEnabled();
    });

    it.each([
        [['privacy-save-yes', 'privacy-ai-yes'], true, true],
        [['privacy-save-yes', 'privacy-ai-no'], true, false],
        [['privacy-save-no'], false, false],
    ])('Continue after %j records save=%s, AI=%s through the one RPC', async (presses, save, ai) => {
        unknownOwner();
        client.rpc.mockResolvedValue({ data: [row(save, ai)], error: null });
        render(<PracticePrivacyPrompt returning={false} />);
        for (const id of presses) fireEvent.click(screen.getByTestId(id));
        fireEvent.click(screen.getByTestId('privacy-continue'));
        await waitFor(() => expect(usePracticePrivacyStore.getState().status).toBe('chosen'));
        expect(client.rpc).toHaveBeenCalledTimes(1);
        expect(client.rpc).toHaveBeenCalledWith('set_practice_privacy_choices_v1',
            { p_transcript_save: save, p_ai_coaching: ai, p_expected_revision: null });
    });

    it('a failed save says nothing changed and leaves the owner unknown (off)', async () => {
        unknownOwner();
        client.rpc.mockResolvedValue({ data: null, error: { message: 'consent_unavailable' } });
        render(<PracticePrivacyPrompt returning={false} />);
        fireEvent.click(screen.getByTestId('privacy-save-yes'));
        fireEvent.click(screen.getByTestId('privacy-ai-yes'));
        fireEvent.click(screen.getByTestId('privacy-continue'));
        expect(await screen.findByTestId('privacy-save-error')).toHaveTextContent(PRIVACY_PROMPT_COPY.saveFailed);
        expect(usePracticePrivacyStore.getState()).toMatchObject({ status: 'unknown', transcriptSave: false, aiCoaching: false });
    });
});

describe('PrivacySettingsCard', () => {
    it('shows the recorded choice, with the AI switch on and enabled when saving is on', () => {
        grantPracticePrivacy();
        render(<PrivacySettingsCard />);
        expect(screen.getByTestId('privacy-settings')).toHaveAttribute('id', 'privacy-data');
        expect(screen.getByTestId('privacy-save-switch')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('privacy-ai-switch')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('privacy-ai-switch')).toBeEnabled();
        expect(screen.getByText(PRIVACY_SETTINGS_COPY.note)).toBeInTheDocument();
        // #1835 scope: no delete controls here.
        expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    });

    it('with saving off, AI coaching is off and unavailable, with the reason', () => {
        grantPracticePrivacy({ transcriptSave: false, aiCoaching: false });
        render(<PrivacySettingsCard />);
        expect(screen.getByTestId('privacy-ai-switch')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('privacy-ai-switch')).toBeDisabled();
        expect(screen.getByTestId('privacy-ai-description')).toHaveTextContent(PRIVACY_SETTINGS_COPY.aiNeedsSave);
    });

    it.each([
        ['loading', PRIVACY_SETTINGS_COPY.loading],
        ['unavailable', PRIVACY_SETTINGS_COPY.unavailable],
    ] as const)('%s: both switches off and disabled', (status, copy) => {
        resetPracticePrivacyForTests();
        usePracticePrivacyStore.setState({ ownerId: TEST_PRIVACY_OWNER, status });
        render(<PrivacySettingsCard />);
        expect(screen.getByText(copy)).toBeInTheDocument();
        expect(screen.getByTestId('privacy-save-switch')).toBeDisabled();
        expect(screen.getByTestId('privacy-ai-switch')).toBeDisabled();
    });

    it('unknown: off, says so, and turning saving on records save only', async () => {
        unknownOwner();
        client.rpc.mockResolvedValue({ data: [row(true, false)], error: null });
        render(<PrivacySettingsCard />);
        expect(screen.getByTestId('privacy-settings-unknown')).toHaveTextContent(PRIVACY_SETTINGS_COPY.unknown);
        fireEvent.click(screen.getByTestId('privacy-save-switch'));
        await waitFor(() => expect(client.rpc).toHaveBeenCalledWith('set_practice_privacy_choices_v1',
            { p_transcript_save: true, p_ai_coaching: false, p_expected_revision: null }));
    });

    it('stopping saving asks first (S7); Cancel changes nothing', async () => {
        grantPracticePrivacy();
        render(<PrivacySettingsCard />);
        fireEvent.click(screen.getByTestId('privacy-save-switch'));
        const dialog = await screen.findByTestId('privacy-stop-saving-dialog');
        expect(dialog).toHaveTextContent(PRIVACY_SETTINGS_COPY.stopTitle);
        expect(dialog).toHaveTextContent(PRIVACY_SETTINGS_COPY.stopBody);
        fireEvent.click(screen.getByTestId('privacy-stop-saving-cancel'));
        await waitFor(() => expect(screen.queryByTestId('privacy-stop-saving-dialog')).toBeNull());
        expect(client.rpc).not.toHaveBeenCalled();
        expect(usePracticePrivacyStore.getState()).toMatchObject({ transcriptSave: true, aiCoaching: true });
    });

    it('confirming Stop saving turns saving AND AI coaching off at once, and records both off', async () => {
        grantPracticePrivacy();
        client.rpc.mockImplementation(() => new Promise(() => { /* in flight */ }));
        render(<PrivacySettingsCard />);
        fireEvent.click(screen.getByTestId('privacy-save-switch'));
        fireEvent.click(await screen.findByTestId('privacy-stop-saving-confirm'));
        expect(usePracticePrivacyStore.getState()).toMatchObject({ transcriptSave: false, aiCoaching: false, revision: null });
        expect(client.rpc).toHaveBeenCalledWith('set_practice_privacy_choices_v1',
            { p_transcript_save: false, p_ai_coaching: false, p_expected_revision: 1 });
    });

    it('turning AI coaching off keeps saving on, takes effect at once, and needs no confirmation', async () => {
        grantPracticePrivacy();
        client.rpc.mockImplementation(() => new Promise(() => { /* in flight */ }));
        render(<PrivacySettingsCard />);
        act(() => { fireEvent.click(screen.getByTestId('privacy-ai-switch')); });
        expect(screen.queryByTestId('privacy-stop-saving-dialog')).toBeNull();
        expect(usePracticePrivacyStore.getState()).toMatchObject({ transcriptSave: true, aiCoaching: false });
        expect(client.rpc).toHaveBeenCalledWith('set_practice_privacy_choices_v1',
            { p_transcript_save: true, p_ai_coaching: false, p_expected_revision: 1 });
    });

    it('a stale coaching toggle shows the other tab’s revocation and does not retry it', async () => {
        grantPracticePrivacy();
        client.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'privacy_choices_changed' } });
        client.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row(false, false, 2), error: null }) }) }) });
        render(<PrivacySettingsCard />);
        fireEvent.click(screen.getByTestId('privacy-ai-switch'));
        expect(await screen.findByTestId('privacy-settings-error')).toHaveTextContent(PRIVACY_SETTINGS_COPY.changed);
        expect(screen.getByTestId('privacy-save-switch')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('privacy-ai-switch')).toBeDisabled();
        expect(client.rpc).toHaveBeenCalledTimes(1);
        expect(usePracticePrivacyStore.getState().revision).toBe(2);
    });

    it('a failed change says so', async () => {
        grantPracticePrivacy({ transcriptSave: true, aiCoaching: false });
        client.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
        render(<PrivacySettingsCard />);
        fireEvent.click(screen.getByTestId('privacy-ai-switch'));
        expect(await screen.findByTestId('privacy-settings-error')).toHaveTextContent(PRIVACY_SETTINGS_COPY.failed);
    });
});
