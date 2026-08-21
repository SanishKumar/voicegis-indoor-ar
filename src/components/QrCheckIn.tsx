import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createQrDecoder } from '../capture/qrDecoder';
import { initialScanGate, shouldSubmitScan } from '../capture/scanGate';

/**
 * The camera half of a check-in: read a QR code, hand back its payload.
 *
 * Deliberately knows nothing about venues, anchors or routing. It reports a
 * string; deciding whether that string means anything is
 * `checkInFromScan`'s job. Keeping the camera out of that decision means the
 * resolution rules are testable without a webcam.
 *
 * Decoding is delegated to `createQrDecoder`, which picks the platform's own
 * `BarcodeDetector` where it exists and falls back to jsQR where it does not —
 * notably on iOS, where Safari has no BarcodeDetector at all.
 */

type ScannerState =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'denied' }
  | { kind: 'failed'; detail: string };

/** How often the video frame is inspected. Faster buys nothing on a still sign. */
const SCAN_INTERVAL_MS = 200;

export default function QrCheckIn({
  onPayload,
  onClose,
  hint,
}: {
  /**
   * Handed each decoded payload. Returns whether it was accepted.
   *
   * The verdict is the caller's because only the caller knows the venue. The
   * scanner keeps its camera running until it hears `true`, which is what makes
   * a wrong code recoverable instead of terminal.
   */
  onPayload: (payload: string) => boolean;
  onClose: () => void;
  hint?: string | null;
}) {
  const [state, setState] = useState<ScannerState>({ kind: 'starting' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // A detection fires while the loop is still scheduled, so without this the
  // same code resolves several times and the modal closes over itself. Settling
  // tracks *acceptance*, never merely a successful decode.
  const gateRef = useRef(initialScanGate());
  // Identifies the effect run that owns the camera. Every asynchronous step
  // rechecks it, because getUserMedia, play and decode all resolve on later
  // ticks, by which time the scanner may have been closed - or closed and
  // reopened, which is the harder case.
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = (generationRef.current += 1);
    const current = () => generationRef.current === generation;
    const decoder = createQrDecoder();

    // Owned by this effect run alone, held in closure rather than in refs.
    //
    // Refs are shared across runs, so a stale continuation that called a shared
    // teardown stopped whichever stream the ref happened to hold - after a
    // reopen, the *new* run's camera. Checking the generation stopped a stale
    // run proceeding; it could not stop it releasing something it never owned.
    // Owning the resources is what makes that impossible rather than unlikely.
    let ownedStream: MediaStream | null = null;
    let ownedTimer: number | null = null;

    const release = () => {
      if (ownedTimer !== null) {
        window.clearInterval(ownedTimer);
        ownedTimer = null;
      }
      // Releasing every track is what actually turns the camera light off. A
      // stopped video element alone leaves the device held open.
      ownedStream?.getTracks().forEach((track) => track.stop());
      ownedStream = null;
    };

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera is the one pointed at the sign.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        // Claimed before the cancellation check, so that a scanner closed while
        // this was in flight still releases the camera it opened.
        ownedStream = stream;
        if (!current()) {
          release();
          return;
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
          if (!current()) {
            release();
            return;
          }
        }
        setState({ kind: 'scanning' });

        ownedTimer = window.setInterval(() => {
          if (!current()) {
            release();
            return;
          }
          const source = videoRef.current;
          if (!source || gateRef.current.settled || source.readyState < 2) return;
          void decoder
            .decode(source)
            .then((value) => {
              // A decode in flight when the scanner closes would otherwise
              // still report its payload, checking the visitor in at a sign
              // they had already dismissed.
              if (!current() || !shouldSubmitScan(value, gateRef.current)) return;
              const payload = (value as string).trim();
              // The camera is only released once the caller has accepted. A
              // rejected code leaves the scanner live so the visitor can walk
              // to another sign and try again.
              if (onPayload(payload)) {
                gateRef.current = { ...gateRef.current, settled: true };
                release();
                return;
              }
              gateRef.current = { ...gateRef.current, lastRejected: payload };
            })
            .catch(() => {
              // A single failed frame is normal while focus settles. Only a
              // permanently broken detector matters, and that surfaces as no
              // detections rather than as an error worth showing.
            });
        }, SCAN_INTERVAL_MS);

        // Cleanup can run between scheduling the interval and this line.
        if (!current()) release();
      } catch (error) {
        if (!current()) return;
        const name = (error as { name?: string }).name;
        setState(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? { kind: 'denied' }
            : { kind: 'failed', detail: name ?? 'the camera could not be opened' },
        );
      }
    })();

    return () => {
      // Retiring the generation makes every pending continuation above inert,
      // and release() touches only what this run opened.
      generationRef.current += 1;
      release();
    };
  }, [onPayload]);

  return (
    <div className="qr-checkin-overlay" role="dialog" aria-modal="true" aria-label="Scan a check-in code">
      <div className="qr-checkin">
        <button type="button" className="qr-checkin-close" onClick={onClose} aria-label="Close scanner">
          <X size={18} />
        </button>

        <div className="qr-checkin-stage">
          <video ref={videoRef} className="qr-checkin-video" muted playsInline />
          <div className="qr-checkin-reticle" aria-hidden="true" />
        </div>

        <p className="qr-checkin-status" role="status">
          {state.kind === 'starting' && 'Opening the camera…'}
          {state.kind === 'scanning' && 'Point the camera at a check-in code.'}
          {state.kind === 'denied' &&
            'Camera access was refused. The camera also needs a secure connection — https, not http.'}
          {state.kind === 'failed' && `The camera could not be opened (${state.detail}).`}
        </p>

        {hint && (
          <p className="qr-checkin-hint" role="alert">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
