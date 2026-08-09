import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { MicCard } from '../MicCard';

// #1222 slot A — mic card: start control, Private-only (input-device picker not an engine selector), error in place.
describe('MicCard (#1222 slot A)', () => {
    it('renders the start control with the prompt copy and fires onStart', () => {
        const onStart = vi.fn();
        render(<MicCard onStart={onStart} />);
        expect(screen.getByText('Press to start speaking')).toBeInTheDocument();
        expect(screen.getByText(/Space bar works too/)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('mic-start'));
        expect(onStart).toHaveBeenCalledOnce();
    });

    it('shows an input-device picker only when devices are supplied (labelled as a mic device, not an engine)', () => {
        const { rerender } = render(<MicCard onStart={vi.fn()} />);
        expect(screen.queryByTestId('mic-device-select')).toBeNull();

        const onSelectDevice = vi.fn();
        rerender(
            <MicCard
                onStart={vi.fn()}
                devices={[{ deviceId: 'a', label: 'Built-in Mic' }, { deviceId: 'b', label: 'USB Mic' }]}
                selectedDeviceId="a"
                onSelectDevice={onSelectDevice}
            />,
        );
        const select = screen.getByTestId('mic-device-select');
        expect(select).toHaveAccessibleName('Microphone input device');
        fireEvent.change(select, { target: { value: 'b' } });
        expect(onSelectDevice).toHaveBeenCalledWith('b');
    });

    it('renders a permission/device error in place (page stays in before)', () => {
        render(<MicCard onStart={vi.fn()} error="Microphone access was blocked." />);
        expect(screen.getByTestId('mic-error')).toHaveTextContent('Microphone access was blocked.');
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // #1222 S12a — Private model lifecycle so a first-time user can download + start.
    it('download-required: the primary control downloads the model instead of starting', () => {
        const onStart = vi.fn();
        const onDownloadModel = vi.fn();
        render(<MicCard onStart={onStart} privateModelStatus="download-required" onDownloadModel={onDownloadModel} />);
        expect(screen.getByTestId('mic-card')).toHaveAttribute('data-model-status', 'download-required');
        expect(screen.getByText(/Download to start speaking/i)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('mic-download'));
        expect(onDownloadModel).toHaveBeenCalledOnce();
        expect(onStart).not.toHaveBeenCalled();
    });

    it('loading: shows progress and disables start', () => {
        render(<MicCard onStart={vi.fn()} privateModelStatus="loading" modelLoadingProgress={0.42} />);
        expect(screen.getByTestId('mic-progress')).toHaveTextContent('42%');
        expect(screen.getByText(/Preparing private transcription/i)).toBeInTheDocument();
        expect(screen.getByTestId('mic-start')).toBeDisabled();
    });

    it('disabled prop blocks the start control (busy)', () => {
        render(<MicCard onStart={vi.fn()} disabled />);
        expect(screen.getByTestId('mic-start')).toBeDisabled();
    });
});
