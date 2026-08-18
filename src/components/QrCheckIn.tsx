import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createQrDecoder } from '../capture/qrDecoder';

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
  onPayload: (payload: string) => void;
  onClose: () => void;
  hint?: string | null;
}) {
  const [state, setState] = useState<ScannerState>({ kind: 'starting' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  // A detection fires while the loop is still scheduled, so without this the
  // same code resolves several times and the modal closes over itself.
  const settledRef = useRef(false);

  const teardown = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Releasing every track is what actually turns the camera light off. A
    // stopped video element alone leaves the device held open.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  useEffect(() => {
    let cancelled = false;
    const decoder = createQrDecoder();

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera is the one pointed at the sign.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setState({ kind: 'scanning' });

        timerRef.current = window.setInterval(() => {
          const source = videoRef.current;
          if (!source || settledRef.current || source.readyState < 2) return;
          void decoder
            .decode(source)
            .then((value) => {
              if (!value || settledRef.current) return;
              settledRef.current = true;
              teardown();
              onPayload(value);
            })
            .catch(() => {
              // A single failed frame is normal while focus settles. Only a
              // permanently broken detector matters, and that surfaces as no
              // detections rather than as an error worth showing.
            });
        }, SCAN_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        const name = (error as { name?: string }).name;
        setState(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? { kind: 'denied' }
            : { kind: 'failed', detail: name ?? 'the camera could not be opened' },
        );
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [onPayload, teardown]);

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
