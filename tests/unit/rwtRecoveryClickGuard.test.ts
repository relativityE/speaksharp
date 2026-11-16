// @vitest-environment jsdom
// Sam, 2026-11-15 (#1869 on c0c085ac): the recovery press's in-page click guard, exercised in a real DOM. The guard must re-check
// the recorder and the unique planned control AT ACTIVATION, give no credit to a recorder that started after discovery, and
// never stay armed after its attempt (a click that times out before dispatch must not leave it to swallow a later click).
import { afterEach, describe, expect, it } from 'vitest';
import { armRecoveryClickGuard, disarmRecoveryClickGuard } from '../live/helpers/rwtPendingStartRecovery';

const ARGS = (token: string) => ({ id: 'mic-start', recorderStopId: 'recorder-stop', token });
function mount(): { button: HTMLButtonElement; productClicks: () => number } {
    document.body.innerHTML = '';
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'mic-start');
    let clicks = 0;
    button.addEventListener('click', () => { clicks += 1; });
    document.body.appendChild(button);
    return { button, productClicks: () => clicks };
}

describe('armRecoveryClickGuard: re-checked at activation, scoped to one attempt', () => {
    afterEach(() => { document.body.innerHTML = ''; });
    it('accepts one click on the unique enabled planned control with no recorder, and the product sees it', () => {
        const { button, productClicks } = mount();
        armRecoveryClickGuard(button, ARGS('t1'));
        button.click();
        expect(disarmRecoveryClickGuard('t1')).toEqual({ accepted: true, rejected: false, reason: '' });
        expect(productClicks()).toBe(1);
    });
    it('LATE recorder: a recorder that appears after arming is caught at activation; no credit, the product never sees the click', () => {
        const { button, productClicks } = mount();
        armRecoveryClickGuard(button, ARGS('t2'));
        const recorder = document.createElement('button');
        recorder.setAttribute('data-testid', 'recorder-stop');
        document.body.appendChild(recorder);
        button.click();
        expect(disarmRecoveryClickGuard('t2')).toEqual({ accepted: false, rejected: true, reason: 'recorder' });
        expect(productClicks()).toBe(0);
    });
    it('a control that changed (Retry flip), became disabled, or is no longer unique at activation is refused', () => {
        for (const change of ['flip', 'disabled', 'duplicate'] as const) {
            const { button, productClicks } = mount();
            armRecoveryClickGuard(button, ARGS(`t3-${change}`));
            if (change === 'flip') button.setAttribute('data-testid', 'mic-retry');
            if (change === 'disabled') button.disabled = true;
            if (change === 'duplicate') { const twin = document.createElement('button'); twin.setAttribute('data-testid', 'mic-start'); document.body.appendChild(twin); }
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            const seen = disarmRecoveryClickGuard(`t3-${change}`);
            expect(seen?.accepted).toBe(false);
            expect(seen?.reason).toBe('control');
            expect(productClicks()).toBe(0);
        }
    });
    it('TIMEOUT before dispatch: disarming in finally removes the listener, so a later click is not swallowed', () => {
        const { button, productClicks } = mount();
        armRecoveryClickGuard(button, ARGS('t4'));
        // The click never dispatched (timed out); the caller's finally disarms.
        expect(disarmRecoveryClickGuard('t4')).toEqual({ accepted: false, rejected: false, reason: '' });
        // Make the page state one the guard WOULD refuse, then click: with the guard gone, the product handles it normally.
        button.setAttribute('data-testid', 'mic-retry');
        button.click();
        expect(productClicks()).toBe(1);
        expect(disarmRecoveryClickGuard('t4')).toBeNull();
    });
    it('the listener removes itself after its one click: a second click is not judged or swallowed', () => {
        const { button, productClicks } = mount();
        armRecoveryClickGuard(button, ARGS('t5'));
        button.click();
        button.setAttribute('data-testid', 'mic-retry');
        button.click();
        expect(productClicks()).toBe(2);
        expect(disarmRecoveryClickGuard('t5')?.accepted).toBe(true);
    });
    it('attempts are scoped by token: disarming one leaves another armed, and disarming is idempotent', () => {
        const { button } = mount();
        armRecoveryClickGuard(button, ARGS('a'));
        armRecoveryClickGuard(button, ARGS('b'));
        expect(disarmRecoveryClickGuard('a')).not.toBeNull();
        expect(disarmRecoveryClickGuard('a')).toBeNull();
        button.click();
        expect(disarmRecoveryClickGuard('b')?.accepted).toBe(true);
    });
});
