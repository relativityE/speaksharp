import { cleanup, fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { FreestylePromptCard } from '../FreestylePromptCard';

describe('FreestylePromptCard', () => {
  afterEach(cleanup);

  it('lets the user dismiss the local setup reminder accessibly', () => {
    render(
      <FreestylePromptCard
        focus="concise"
        prompt="Give a short update: main point, current status, and next step."
      />,
    );

    expect(screen.getByTestId('freestyle-prompt-card')).toBeInTheDocument();
    const dismiss = screen.getByRole('button', { name: 'Dismiss Freestyle setup' });
    dismiss.focus();
    fireEvent.click(dismiss);

    expect(screen.queryByTestId('freestyle-prompt-card')).not.toBeInTheDocument();
  });

  it('stays absent when no focus or prompt was selected', () => {
    render(<FreestylePromptCard focus="just-practice" prompt={null} />);
    expect(screen.queryByTestId('freestyle-prompt-card')).not.toBeInTheDocument();
  });
});
