/**
 * STT-IDENTITY-DIAG — dev/test-only STT identity badge.
 *
 * Shows which STT engine/model is actually running during a manual proof. Self-gates on the debug
 * flag (`isSttDebugEnabled`), so it renders NOTHING for normal users. It reads the read-only
 * `collectSttIdentityFromWindow()` snapshot and refreshes on a 1s tick (v4 device/runtime appears
 * only after the model loads). Styling is intentionally minimal — the test agent owns final UX.
 *
 * NOTE: this is the same identity exposed at `window.__STT_IDENTITY__()` and folded into
 * `window.__STT_EVIDENCE__().identity`, so on-screen and artifact identity always agree.
 */
import { useEffect, useState } from 'react';
import { isSttDebugEnabled } from '@/lib/sttDebug';
import { collectSttIdentityFromWindow, type SttIdentity } from '@/services/transcription/sttIdentity';
import { NOT_AVAILABLE } from '@/services/transcription/sttEvidence';

function show(v: unknown): string {
    return v === undefined || v === null || v === NOT_AVAILABLE ? '—' : String(v);
}

export default function SttIdentityBadge() {
    const [enabled] = useState(() => isSttDebugEnabled());
    const [identity, setIdentity] = useState<SttIdentity | null>(null);

    useEffect(() => {
        if (!enabled) return;
        const read = () => setIdentity(collectSttIdentityFromWindow());
        read();
        const timer = setInterval(read, 1000);
        return () => clearInterval(timer);
    }, [enabled]);

    if (!enabled || !identity) return null;

    const sizeText = identity.approxMB !== NOT_AVAILABLE && identity.approxMB != null
        ? `~${identity.approxMB} MB`
        : '—';

    return (
        <div
            data-testid="stt-identity-badge"
            className="fixed bottom-3 right-3 z-[120] max-w-[16rem] rounded-md border border-sky-700 bg-sky-950/90 px-3 py-2 font-mono text-[11px] leading-tight text-sky-100 shadow-lg"
        >
            <div className="font-bold uppercase tracking-wide">STT identity · debug</div>
            <div data-testid="stt-identity-mode">mode: {show(identity.mode)}</div>
            <div data-testid="stt-identity-provider">provider: {show(identity.provider)}</div>
            <div data-testid="stt-identity-engine">
                engine: {show(identity.engine)} ({identity.engineSelection})
            </div>
            <div data-testid="stt-identity-model">model: {show(identity.modelId)}</div>
            <div data-testid="stt-identity-selection">
                select: {show(identity.selectionSource)}{identity.modelOverridden === true ? ' · override' : ''}
            </div>
            <div data-testid="stt-identity-size">size: {sizeText}</div>
            <div data-testid="stt-identity-modelsource">source: {show(identity.modelSource)}</div>
            <div data-testid="stt-identity-device">
                device: {show(identity.resolvedDevice)} / {show(identity.backend)}
            </div>
            <div data-testid="stt-identity-dtype">dtype: {show(identity.dtype)}</div>
            <div data-testid="stt-identity-fallback">fallback: {show(identity.fallbackOccurred)}</div>
            <div data-testid="stt-identity-release">status: {show(identity.releaseStatus)}</div>
        </div>
    );
}
