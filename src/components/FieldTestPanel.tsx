import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ClipboardList, X } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import {
  clearFieldLog,
  fieldEvents,
  fieldTestEnabled,
  stopFieldTest,
  subscribeFieldLog,
  type FieldEvent,
} from '../fieldTest/fieldLog';
import { formatFieldReport, probeHandset, type HandsetFacts } from '../fieldTest/fieldReport';
import { useDialogFocus } from './useDialogFocus';
import './fieldTestPanel.css';

/** The commit the build was made from, where the build could tell. */
const BUILD = typeof __APP_REVISION__ === 'string' ? __APP_REVISION__ : 'unknown';

let version = 0;
function subscribe(listener: () => void) {
  return subscribeFieldLog(() => {
    version += 1;
    listener();
  });
}
const snapshot = () => version;

/**
 * The tester's way to get the record off the phone: a small button, and a
 * sheet with the report as selectable text and a copy button. Shown only when
 * the app was opened with `?fieldtest=1`.
 */
export default function FieldTestPanel() {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<HandsetFacts | null>(null);
  const [events, setEvents] = useState<readonly FieldEvent[]>([]);
  const [reportVenue, setReportVenue] = useState('');
  const [consent, setConsent] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copyRequest = useRef(0);
  const { venue } = useNavigation() as {
    venue: {
      buildingPackage: { building: { id: string }; manifest: { contentHash: string } };
    };
  };
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const close = () => {
    copyRequest.current += 1;
    setConsent(false);
    setOpen(false);
  };
  const { containerRef } = useDialogFocus<HTMLDivElement>(open, {
    onEscape: close,
  });

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    void probeHandset().then((next) => {
      if (current) setFacts(next);
    });
    return () => {
      current = false;
    };
  }, [open]);

  if (!fieldTestEnabled()) return null;

  const report = facts
    ? formatFieldReport({
        facts,
        events,
        build: BUILD,
        venue: reportVenue,
      })
    : 'Reading what this phone offers…';

  const copy = async () => {
    if (!consent || facts === null) return;
    const request = ++copyRequest.current;
    setCopied('copying');
    try {
      await navigator.clipboard.writeText(report);
      if (request === copyRequest.current) setCopied('copied');
    } catch {
      // No clipboard here: the text below can still be selected by hand.
      if (request === copyRequest.current) setCopied('failed');
    }
  };

  const refresh = () => {
    copyRequest.current += 1;
    setEvents(fieldEvents().map((event) => ({ ...event, detail: { ...event.detail } })));
    setReportVenue(
      `${venue.buildingPackage.building.id} ${venue.buildingPackage.manifest.contentHash.slice(0, 12)}`,
    );
    setConsent(false);
    setCopied('idle');
  };

  return (
    <>
      <button
        type="button"
        className="field-test-button"
        onClick={() => {
          refresh();
          setFacts(null);
          setOpen(true);
        }}
      >
        <ClipboardList size={16} aria-hidden="true" />
        Test log
      </button>
      {open && (
        <div
          className="field-test-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={containerRef}
            className="field-test-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="field-test-title"
            tabIndex={-1}
          >
            <div className="field-test-header">
              <h2 id="field-test-title">Field test log</h2>
              <button type="button" className="field-test-close" aria-label="Close" onClick={close}>
                <X size={18} />
              </button>
            </div>
            <p className="field-test-note">
              Includes browser details, venue/sign IDs and movement history. No camera images or
              audio. Kept in this tab’s memory until reload or close; nothing uploads automatically.
              Share only with someone you trust.
            </p>
            <p className="field-test-note" id="field-test-preview-note">
              This is a snapshot. Recording continues; refresh to include later events. Copying does
              not send it anywhere.
            </p>
            <textarea
              className="field-test-text"
              aria-label="Field test report"
              aria-describedby="field-test-preview-note"
              readOnly
              value={report}
            />
            <label className="field-test-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={facts === null || copied === 'copying'}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I’ve reviewed this report and want to copy it.
            </label>
            <div className="field-test-actions">
              <button
                type="button"
                className="field-test-action is-primary"
                disabled={facts === null || !consent || copied === 'copying'}
                onClick={() => void copy()}
              >
                {copied === 'copied'
                  ? 'Copied'
                  : copied === 'copying'
                    ? 'Copying…'
                    : copied === 'failed'
                      ? 'Select the text to copy'
                      : 'Copy report'}
              </button>
              <button type="button" className="field-test-action" onClick={refresh}>
                Refresh report
              </button>
            </div>
            <div className="field-test-actions">
              <button
                type="button"
                className="field-test-action"
                onClick={() => {
                  clearFieldLog();
                  refresh();
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="field-test-action"
                onClick={() => {
                  close();
                  setEvents([]);
                  stopFieldTest();
                }}
              >
                Stop logging and clear
              </button>
            </div>
            <p className="field-test-note" role="status">
              {copied === 'copied'
                ? 'Copied to your clipboard. Paste it only where you want to share it.'
                : copied === 'failed'
                  ? 'Clipboard unavailable. You can select and copy the reviewed text yourself.'
                  : 'Clearing removes this tab’s log, not copies you have already shared.'}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
