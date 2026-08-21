import { describe, expect, it } from 'vitest';
import { initialScanGate, shouldSubmitScan, type ScanGateState } from './scanGate';

/**
 * Regression for a scanner that froze on a wrong code.
 *
 * It settled on the first successful decode rather than on acceptance, so a
 * code from another venue stopped the camera and left the modal open and inert:
 * the visitor was told the code was wrong and given no way to try another.
 */

const gate = (overrides: Partial<ScanGateState> = {}): ScanGateState => ({
  ...initialScanGate(),
  ...overrides,
});

describe('deciding what to hand the caller', () => {
  it('offers a decoded payload', () => {
    expect(shouldSubmitScan('voicegis://asterion/g/west', gate())).toBe(true);
  });

  it('keeps offering after a rejection, so a wrong code is recoverable', () => {
    // The defect: a rejected code used to end the session outright.
    const afterRejection = gate({ lastRejected: 'voicegis://elsewhere/g/west' });

    expect(shouldSubmitScan('voicegis://asterion/g/west', afterRejection)).toBe(true);
  });

  it('does not refire the same rejected code frame after frame', () => {
    // Held in front of the lens this decodes several times a second, and each
    // one would re-raise the same message.
    const afterRejection = gate({ lastRejected: 'voicegis://elsewhere/g/west' });

    expect(shouldSubmitScan('voicegis://elsewhere/g/west', afterRejection)).toBe(false);
    expect(shouldSubmitScan('  voicegis://elsewhere/g/west  ', afterRejection)).toBe(false);
  });

  it('stops entirely once a payload has been accepted', () => {
    expect(shouldSubmitScan('voicegis://asterion/g/east', gate({ settled: true }))).toBe(false);
  });

  it('ignores the empty reads a camera produces while focusing', () => {
    expect(shouldSubmitScan(null, gate())).toBe(false);
    expect(shouldSubmitScan('', gate())).toBe(false);
    expect(shouldSubmitScan('   ', gate())).toBe(false);
  });
});
