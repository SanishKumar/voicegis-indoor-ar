/**
 * Deciding whether a decoded value is worth handing to the caller.
 *
 * The scanner reads several frames a second, so without a gate a single code in
 * front of the lens is reported over and over. The first version handled that by
 * settling on the first successful *decode* — tearing the camera down before the
 * caller had said whether the payload meant anything. A code from another venue
 * therefore left the modal open, the camera stopped and the scanner permanently
 * settled: the visitor was told their code was wrong and given no way to try
 * another one.
 *
 * Settling now belongs to acceptance, not decoding. Until a payload is accepted
 * the camera keeps running; a payload already rejected is held back so the same
 * bad sticker does not refire the message many times a second.
 */

export interface ScanGateState {
  /** A payload has been accepted and the scanner is finished. */
  settled: boolean;
  /** The last payload the caller refused, if any. */
  lastRejected: string | null;
}

export function initialScanGate(): ScanGateState {
  return { settled: false, lastRejected: null };
}

/**
 * Whether a freshly decoded value should be offered to the caller.
 *
 * Empty reads are normal while focus settles and mean nothing.
 */
export function shouldSubmitScan(value: string | null, state: ScanGateState): boolean {
  if (state.settled) return false;
  if (value === null) return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  // Re-offer a different code immediately, including one rejected earlier than
  // the most recent: the visitor may be walking between two signs.
  return trimmed !== state.lastRejected;
}
