import { describe, it, expect } from 'vitest';

/**
 * 🕵️ REHYDRATION PROBE (Step 3 Validation)
 * ---------------------------------------
 * This probe validates the Step 3 hypothesis: 
 * "Synchronous rehydration upon subscription eliminates the visibility gap."
 */

describe('Case 2: Rehydration Invariant Probe', () => {
  it('should synchronously re-capture persistent state during a rapid re-subscription pulse', async () => {
    // 1. MOCK PERSISTENT STATE
    const persistentState = {
      state: 'RECORDING',
      transcript: 'Hello persistent world',
      isReady: true
    };

    // 2. DEFINE THE REHYDRATION CONTRACT (The Step 3 Target)
    const mockService = {
      subscribe: (handler: (sync: typeof persistentState) => void) => {
        // 🔥 THE STEP 3 IMPLEMENTATION (Validated here first)
        handler(persistentState); 
        return () => {};
      }
    };

    // 3. THE UI OBSERVER (The Controller / Store proxy)
    let capturedState: typeof persistentState | null = null;
    const subscriber = (sync: typeof persistentState) => {
      capturedState = sync;
    };

    // 4. THE PULSE: Subscribe synchronously
    mockService.subscribe(subscriber);

    // 5. INVARIANT PROOF: Captured in the SAME TICK
    const observed = capturedState as unknown as Record<string, unknown>;
    expect(observed).not.toBeNull();
    expect(observed?.state).toBe('RECORDING');
    expect(observed?.transcript).toBe('Hello persistent world');
  });

  it('should reproduce the FAILURE if rehydration is asynchronous', async () => {
    const persistentState = { state: 'RECORDING', transcript: 'fail', isReady: true };
    
    // THE BUG: Async rehydration (The reason for the current regressions)
    const mockServiceWithBug = {
      subscribe: (handler: (sync: typeof persistentState) => void) => {
        setTimeout(() => handler(persistentState), 0);
        return () => {};
      }
    };

    let capturedState: typeof persistentState | null = null;
    mockServiceWithBug.subscribe((sync) => { capturedState = sync; });

    // PROOF: It is NULL in this tick (The visibility gap)
    expect(capturedState).toBeNull();
  });
});
