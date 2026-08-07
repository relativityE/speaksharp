import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PracticeOnramp } from '@/components/session/PracticeOnramp';
import { SPEAKING_PROMPTS, SAMPLE_PASSAGES } from '@/services/practice/practiceOnramp';

describe('PracticeOnramp (#1116 session-page on-ramp)', () => {
  it('offers a prompt and a sample as the two choices', () => {
    render(<PracticeOnramp />);
    expect(screen.getByRole('heading', { name: /not sure what to say/i })).toBeInTheDocument();
    expect(screen.getByTestId('onramp-give-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('onramp-test-sample')).toBeInTheDocument();
  });

  it('"Give me a prompt" reveals a speaking starter from the corpus', () => {
    render(<PracticeOnramp />);
    fireEvent.click(screen.getByTestId('onramp-give-prompt'));
    const shown = screen.getByTestId('onramp-prompt').textContent ?? '';
    expect(SPEAKING_PROMPTS.some((p) => shown.includes(p.text))).toBe(true);
  });

  it('"Let me test with a sample" reveals a ≤45s public-domain passage with attribution', () => {
    render(<PracticeOnramp />);
    fireEvent.click(screen.getByTestId('onramp-test-sample'));
    const first = SAMPLE_PASSAGES[0];
    expect(screen.getByTestId('onramp-sample-text')).toHaveTextContent(first.text.slice(0, 24));
    expect(screen.getByText(new RegExp(first.attribution.split(' · ')[0], 'i'))).toBeInTheDocument();
    expect(first.estSeconds).toBeLessThanOrEqual(45);
  });

  it('cycles to another sample and can switch to a prompt', () => {
    render(<PracticeOnramp />);
    fireEvent.click(screen.getByTestId('onramp-test-sample'));
    fireEvent.click(screen.getByTestId('onramp-next-sample'));
    expect(screen.getByTestId('onramp-sample-text')).toHaveTextContent(SAMPLE_PASSAGES[1].text.slice(0, 24));
    fireEvent.click(screen.getByTestId('onramp-switch-prompt'));
    expect(screen.getByTestId('onramp-prompt')).toBeInTheDocument();
  });

  it('collapses to a compact bar and expands again (floating, non-modal)', () => {
    render(<PracticeOnramp />);
    fireEvent.click(screen.getByTestId('onramp-collapse'));
    expect(screen.queryByTestId('onramp-choose')).not.toBeInTheDocument();
    expect(screen.getByTestId('practice-onramp')).toBeInTheDocument(); // still present, just collapsed
    fireEvent.click(screen.getByTestId('onramp-expand'));
    expect(screen.getByTestId('onramp-choose')).toBeInTheDocument();
  });

  it('is dismissible', () => {
    render(<PracticeOnramp />);
    fireEvent.click(screen.getByTestId('onramp-dismiss'));
    expect(screen.queryByTestId('practice-onramp')).not.toBeInTheDocument();
  });

  it('every sample stays within the 30–45s read budget', () => {
    for (const s of SAMPLE_PASSAGES) {
      expect(s.estSeconds).toBeGreaterThanOrEqual(30);
      expect(s.estSeconds).toBeLessThanOrEqual(45);
    }
  });
});
