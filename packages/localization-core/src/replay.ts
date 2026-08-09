/**
 * Public replay surface.
 *
 * The unredacted core lives in `internalReplay` and is deliberately not
 * re-exported here, so it cannot be reached from the package root. Importing it
 * would hand back raw checkpoint errors and let an aggregate be recomputed
 * outside the evidence path, which is exactly what that path exists to control.
 */
export { replayRecording, validateRecording, type ReplayResult } from './internalReplay';
