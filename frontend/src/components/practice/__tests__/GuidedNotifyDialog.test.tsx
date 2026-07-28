import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuidedNotifyDialog } from '../GuidedNotifyDialog';

// #1061 — the Guided "Notify me" dialog has two states gated by the `enabled` activation flag:
//  - enabled=false (default OFF, the SHIPPED state): honest coming-soon acknowledgement, NO capture form,
//    NO backend call;
//  - enabled=true (post-activation): the real email + consent capture form with honest success/error.
// This proves BOTH independently of the page's activation flag.

const submitWaitlist = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true }));
vi.mock('@/services/guidedWaitlistService', () => ({
  submitGuidedWaitlist: (...a: unknown[]) => submitWaitlist(...a),
}));

function renderDialog(props: Partial<React.ComponentProps<typeof GuidedNotifyDialog>> = {}) {
  return render(
    <MemoryRouter>
      <GuidedNotifyDialog open onOpenChange={() => {}} source="anonymous_landing" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => { submitWaitlist.mockClear(); submitWaitlist.mockResolvedValue({ ok: true }); });

describe('GuidedNotifyDialog', () => {
  describe('activation OFF (enabled=false) — the shipped default', () => {
    it('shows an honest coming-soon acknowledgement with NO form and NO backend call', () => {
      renderDialog({ enabled: false });
      expect(screen.getByTestId('guided-notify-comingsoon')).toBeInTheDocument();
      expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
      expect(screen.queryByTestId('guided-notify-email')).not.toBeInTheDocument();
      expect(screen.queryByTestId('guided-notify-consent')).not.toBeInTheDocument();
      expect(screen.queryByTestId('guided-notify-submit')).not.toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
    });
  });

  describe('activation ON (enabled=true)', () => {
    it('prefills the account email on the authenticated surface', () => {
      renderDialog({ enabled: true, source: 'authenticated_practice', defaultEmail: 'me@example.com' });
      expect(screen.getByTestId('guided-notify-email')).toHaveValue('me@example.com');
    });

    it('honest success: valid email + consent → success acknowledgement + normalized service call', async () => {
      renderDialog({ enabled: true, source: 'authenticated_practice' });
      fireEvent.change(screen.getByTestId('guided-notify-email'), { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByTestId('guided-notify-consent'));
      fireEvent.click(screen.getByTestId('guided-notify-submit'));
      expect(await screen.findByTestId('guided-notify-success')).toHaveTextContent(/you’re on the list/i);
      expect(submitWaitlist).toHaveBeenCalledWith({ email: 'new@example.com', consent: true, source: 'authenticated_practice' });
    });

    it('requires consent before submitting (no service call)', () => {
      renderDialog({ enabled: true });
      fireEvent.change(screen.getByTestId('guided-notify-email'), { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByTestId('guided-notify-submit'));
      expect(screen.getByTestId('guided-notify-field-error')).toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
    });

    it('honest failure: a failed request shows an error, never a false success', async () => {
      submitWaitlist.mockResolvedValue({ ok: false });
      renderDialog({ enabled: true });
      fireEvent.change(screen.getByTestId('guided-notify-email'), { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByTestId('guided-notify-consent'));
      fireEvent.click(screen.getByTestId('guided-notify-submit'));
      await waitFor(() => expect(screen.getByTestId('guided-notify-error')).toBeInTheDocument());
      expect(screen.queryByTestId('guided-notify-success')).not.toBeInTheDocument();
    });
  });
});
