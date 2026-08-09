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

export const MicCard: React.FC<MicCardProps> = ({ onStart, devices, selectedDeviceId, onSelectDevice, error }) => {
    const deviceList = devices ?? [];
    const hasPicker = deviceList.length > 0;

    return (
        <div className="rounded-xl border border-[#dbe2ec] bg-white p-4" data-testid="mic-card">
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#146b4a]">
                    <span className="inline-block h-2 w-2 rounded-full bg-[#146b4a]" aria-hidden="true" />
                    Mic ready on this device
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
                onClick={onStart}
                data-testid="mic-start"
                className="mt-3 flex w-full items-center gap-4 rounded-lg text-left"
            >
                <span
                    className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-[#d98a1f]"
                    aria-hidden="true"
                >
                    <MicGlyph />
                </span>
                <span>
                    <span className="block text-[17px] font-extrabold text-[#1f2733]">Press to start speaking</span>
                    <span className="block text-[13px] text-[#414b5c]">Space bar works too · aim for 60 seconds</span>
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
