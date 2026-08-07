import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectiveNotifyDialog } from '../ObjectiveNotifyDialog';

// #1061 — the Objective "Notify me" dialog has two states gated by the `enabled` activation flag:
//  - enabled=false (default OFF, the SHIPPED state): honest coming-soon acknowledgement, NO capture form,
//    NO backend call;
//  - enabled=true (post-activation): the real email + consent capture form with honest success/error.
// This proves BOTH independently of the page's activation flag.

const submitWaitlist = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true }));
vi.mock('@/services/objectiveWaitlistService', () => ({
  submitGuidedWaitlist: (...a: unknown[]) => submitWaitlist(...a),
}));

function renderDialog(props: Partial<React.ComponentProps<typeof ObjectiveNotifyDialog>> = {}) {
  return render(
    <MemoryRouter>
      <ObjectiveNotifyDialog open onOpenChange={() => {}} source="anonymous_landing" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => { submitWaitlist.mockClear(); submitWaitlist.mockResolvedValue({ ok: true }); });

describe('ObjectiveNotifyDialog', () => {
  describe('activation OFF (enabled=false) — the shipped default', () => {
    it('shows an honest coming-soon acknowledgement with NO form and NO backend call', () => {
      renderDialog({ enabled: false });
      expect(screen.getByTestId('objective-notify-comingsoon')).toBeInTheDocument();
      expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
      expect(screen.queryByTestId('objective-notify-email')).not.toBeInTheDocument();
      expect(screen.queryByTestId('objective-notify-consent')).not.toBeInTheDocument();
      expect(screen.queryByTestId('objective-notify-submit')).not.toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
    });
  });

  describe('activation ON (enabled=true)', () => {
    it('prefills the account email on the authenticated surface', () => {
      renderDialog({ enabled: true, source: 'authenticated_practice', defaultEmail: 'me@example.com' });
      expect(screen.getByTestId('objective-notify-email')).toHaveValue('me@example.com');
    });

    it('honest success: valid email + consent → success acknowledgement + normalized service call', async () => {
      renderDialog({ enabled: true, source: 'authenticated_practice' });
      fireEvent.change(screen.getByTestId('objective-notify-email'), { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByTestId('objective-notify-consent'));
      fireEvent.click(screen.getByTestId('objective-notify-submit'));
      expect(await screen.findByTestId('objective-notify-success')).toHaveTextContent(/you’re on the list/i);
      expect(submitWaitlist).toHaveBeenCalledWith({ email: 'new@example.com', consent: true, source: 'authenticated_practice' });
    });

    it('requires consent before submitting (no service call)', () => {
      renderDialog({ enabled: true });
      fireEvent.change(screen.getByTestId('objective-notify-email'), { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByTestId('objective-notify-submit'));
      expect(screen.getByTestId('objective-notify-field-error')).toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
    });

    it('honest failure: a failed request shows an error, never a false success', async () => {
      submitWaitlist.mockResolvedValue({ ok: false });
      renderDialog({ enabled: true });
      fireEvent.change(screen.getByTestId('objective-notify-email'), { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByTestId('objective-notify-consent'));
      fireEvent.click(screen.getByTestId('objective-notify-submit'));
      await waitFor(() => expect(screen.getByTestId('objective-notify-error')).toBeInTheDocument());
      expect(screen.queryByTestId('objective-notify-success')).not.toBeInTheDocument();
    });
  });
});
