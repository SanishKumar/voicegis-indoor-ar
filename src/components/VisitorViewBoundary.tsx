import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './visitorViewBoundary.css';

interface Props {
  view: 'map' | 'camera';
  children: ReactNode;
  recoveryTarget?: HTMLElement | null;
  onExit?: () => void;
}

class ViewErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ViewStatus({
  view,
  failed = false,
  recoveryTarget,
  onExit,
}: Omit<Props, 'children'> & { failed?: boolean }) {
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Opening the camera removes its launch button. Keep keyboard users at
    // the loading/error message and its exit, rather than on an empty body.
    if (view === 'camera') cardRef.current?.focus({ preventScroll: true });
  }, [view, failed]);

  const card = (
    <section
      ref={cardRef}
      className="visitor-view-status"
      role={failed ? 'alert' : 'status'}
      tabIndex={-1}
    >
      <h2>{failed ? `The ${view} could not be opened` : `Opening the ${view}…`}</h2>
      {failed ? (
        <>
          <p>
            {view === 'camera'
              ? 'Your route is still available on the map. Return to it now, or check your connection before reloading.'
              : 'Search and written directions still work. Check your connection before reloading.'}
          </p>
          <p className="visitor-view-reload-note">Reloading the app restarts your journey.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </>
      ) : (
        <p>Your route and check-in are kept while this view loads.</p>
      )}
      {view === 'camera' && (
        <button type="button" onClick={onExit}>
          Exit to plan
        </button>
      )}
    </section>
  );

  // A journey sheet must not cover the map's recovery action. Reuse its
  // existing recovery slot, leaving search and written guidance mounted.
  return recoveryTarget && view === 'map' ? (
    createPortal(card, recoveryTarget)
  ) : (
    <div className="visitor-view-placeholder">{card}</div>
  );
}

/** Heavy view code may load slowly or fail without taking down the journey. */
export default function VisitorViewBoundary({ children, ...props }: Props) {
  return (
    <ViewErrorBoundary fallback={<ViewStatus {...props} failed />}>
      <Suspense fallback={<ViewStatus {...props} />}>{children}</Suspense>
    </ViewErrorBoundary>
  );
}
