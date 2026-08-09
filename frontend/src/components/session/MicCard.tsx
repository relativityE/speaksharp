import React from 'react';

/**
 * #1222 slot A (before) — the mic card. Sizes to content (~150px). STT is **Private only** (#1184/#1229):
 * there is NO engine selector here. The only control is an OS **microphone input-device** picker.
 *
 * Two rows (spec §3):
 *   1. `● Mic ready on this device` (green) left; the input-device picker right.
 *   2. a 76px orange circle with a **real microphone glyph** (capsule body, arc, stand, base — never a
 *      dot/emoji) + "Press to start speaking" / "Space bar works too · aim for 60 seconds".
 *
 * A click that fails mic permission must NOT change the layout — the error renders in this card and the
 * page stays in `before` (spec §4). This component is presentational; the container owns permission state.
 */
export interface MicInputDevice {
    deviceId: string;
    label: string;
}

export interface MicCardProps {
    onStart: () => void;
    /** Available microphone input devices; when >1 the picker is interactive. */
    devices?: MicInputDevice[];
    selectedDeviceId?: string;
    onSelectDevice?: (deviceId: string) => void;
    /** Permission / device error — rendered in place; the page stays in `before`. */
    error?: string | null;
    /**
     * Private on-device model status (#1222 S12a parity): 'idle' | 'loading' | 'ready' |
     * 'download-required' | 'init-failed' | 'error'. Private needs a one-time local model download before it
     * can transcribe, so a first-time user must be able to trigger + watch that here.
     */
    privateModelStatus?: string;
    /** 0..1 download/init progress while the model is loading. */
    modelLoadingProgress?: number | null;
    /** Begin the one-time model download (when download-required). */
    onDownloadModel?: () => void;
    /** Disable the primary control (busy: initialising / downloading / stopping). */
    disabled?: boolean;
}

const MicGlyph: React.FC = () => (
    // Real microphone: capsule body + protective arc + stand + base. Drawn in #241503 (orange-fill text rule).
    <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#241503" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
);

export const MicCard: React.FC<MicCardProps> = ({
    onStart, devices, selectedDeviceId, onSelectDevice, error,
    privateModelStatus = 'ready', modelLoadingProgress, onDownloadModel, disabled,
}) => {
    const deviceList = devices ?? [];
    const hasPicker = deviceList.length > 0;

    const downloadRequired = privateModelStatus === 'download-required';
    const loading = privateModelStatus === 'loading';
    const modelError = privateModelStatus === 'init-failed' || privateModelStatus === 'error';
    const pct = typeof modelLoadingProgress === 'number' ? Math.round(Math.max(0, Math.min(1, modelLoadingProgress)) * 100) : null;

    // Status line (top-left): ready / needs one-time download / DOWNLOADING (with %) / problem. While the
    // model downloads, this is the user's progress cue (it replaces the removed status-notification bar).
    const status = downloadRequired
        ? { dot: '#d98a1f', text: '#a8571f', label: 'One-time download needed' }
        : loading
            ? { dot: '#d98a1f', text: '#a8571f', label: pct != null ? `Downloading private transcription… ${pct}%` : 'Downloading private transcription…' }
            : modelError
                ? { dot: '#a8321f', text: '#a8321f', label: 'Private transcription needs another try' }
                : { dot: '#146b4a', text: '#146b4a', label: 'Mic ready on this device' };

    // Primary action: download when required, otherwise start. The mic is GREYED OUT + disabled for the
    // whole download (loading), then re-enabled to record once the model is ready.
    const primaryHandler = downloadRequired ? (onDownloadModel ?? onStart) : onStart;
    const primaryDisabled = !!disabled || loading;
    const primaryTitle = downloadRequired
        ? 'Download to start speaking'
        : loading ? 'Downloading…' : 'Press to start speaking';
    const primarySub = downloadRequired
        ? 'One-time · downloads to this device, then stays local'
        : loading ? (pct != null ? `${pct}% downloaded — the mic unlocks when it’s ready` : 'the mic unlocks when it’s ready') : 'Space bar works too · aim for 60 seconds';

    return (
        <div className="rounded-xl border border-[#dbe2ec] bg-white p-4" data-testid="mic-card" data-model-status={privateModelStatus}>
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[13px] font-extrabold" style={{ color: status.text }} data-testid="mic-status">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: status.dot }} aria-hidden="true" />
                    {status.label}
                </span>
                {hasPicker && (
                    <select
                        aria-label="Microphone input device"
                        data-testid="mic-device-select"
                        value={selectedDeviceId ?? deviceList[0].deviceId}
                        onChange={(e) => onSelectDevice?.(e.target.value)}
                        className="rounded-lg border border-[#dbe2ec] bg-white px-2 py-1 text-[13px] font-semibold text-[#232c3a]"
                    >
                        {deviceList.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                        ))}
                    </select>
                )}
            </div>

            <button
                type="button"
                onClick={primaryHandler}
                disabled={primaryDisabled}
                aria-label={downloadRequired ? 'Download to start speaking' : 'Start speaking'}
                data-testid={downloadRequired ? 'mic-download' : 'mic-start'}
                className="mt-3 flex w-full items-center gap-4 rounded-lg text-left disabled:opacity-60"
            >
                <span
                    className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-[#d98a1f]"
                    aria-hidden="true"
                >
                    <MicGlyph />
                    {loading && pct != null && (
                        <span className="absolute -bottom-1 rounded-full bg-[#241503] px-1.5 py-0.5 text-[10px] font-bold text-white" data-testid="mic-progress">{pct}%</span>
                    )}
                </span>
                <span>
                    <span className="block text-[17px] font-extrabold text-[#1f2733]">{primaryTitle}</span>
                    <span className="block text-[13px] text-[#414b5c]">{primarySub}</span>
                </span>
            </button>

            {error && (
                <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-[13px] font-semibold text-[#a8321f]" role="alert" data-testid="mic-error">
                    {error}
                </p>
            )}
        </div>
    );
};
