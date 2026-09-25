import { useEffect, useState, useSyncExternalStore } from 'react';
import { ClipboardList, X } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import {
  clearFieldLog,
  fieldEvents,
  fieldTestEnabled,
  subscribeFieldLog,
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
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const { venue } = useNavigation() as {
    venue: {
      buildingPackage: { building: { id: string }; manifest: { contentHash: string } };
    };
  };
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const { containerRef } = useDialogFocus<HTMLDivElement>(open, {
    onEscape: () => setOpen(false),
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
        events: fieldEvents(),
        build: BUILD,
        venue: `${venue.buildingPackage.building.id} ${venue.buildingPackage.manifest.contentHash.slice(0, 12)}`,
      })
    : 'Reading what this phone offers…';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('copied');
    } catch {
      // No clipboard here: the text below can still be selected by hand.
      setCopied('failed');
    }
  };

  return (
    <>
      <button
        type="button"
        className="field-test-button"
        onClick={() => {
          setCopied('idle');
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
            if (event.target === event.currentTarget) setOpen(false);
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
              <button
                type="button"
                className="field-test-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="field-test-note">
              Kept on this phone only, until the page is closed. Copy it into a message to share it.
            </p>
            <textarea
              className="field-test-text"
              aria-label="Field test report"
              readOnly
              value={report}
            />
            <div className="field-test-actions">
              <button
                type="button"
                className="field-test-action is-primary"
                disabled={facts === null}
                onClick={() => void copy()}
              >
                {copied === 'copied'
                  ? 'Copied'
                  : copied === 'failed'
                    ? 'Select the text to copy'
                    : 'Copy report'}
              </button>
              <button
                type="button"
                className="field-test-action"
                onClick={() => {
                  clearFieldLog();
                  setCopied('idle');
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
