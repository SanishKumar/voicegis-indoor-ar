export default function VenueBootstrapState({ status, retryBootstrap, useDefaultVenue }) {
  const failed = status.state === 'error';
  return (
    <main className="venue-bootstrap-state" role={failed ? 'alert' : 'status'}>
      <strong>{failed ? "We couldn't load this venue" : "Loading this venue's map"}</strong>
      <p>
        {failed
          ? 'Check your connection and try again. If this link is out of date, open the default venue.'
          : 'Verifying the map before opening navigation.'}
      </p>
      {failed && (
        <details className="venue-bootstrap-details">
          <summary>Technical details</summary>
          {status.error && <p>{status.error}</p>}
          {status.detail && <p>{status.detail}</p>}
          {status.failedSource && (
            <p className="venue-bootstrap-source">
              Source: <code>{status.failedSource}</code>
            </p>
          )}
        </details>
      )}
      {failed && (
        <div className="venue-bootstrap-actions">
          <button type="button" className="venue-bootstrap-retry" onClick={retryBootstrap}>
            Try again
          </button>
          {status.failedSource && (
            <button type="button" className="venue-bootstrap-default" onClick={useDefaultVenue}>
              Open default venue
            </button>
          )}
        </div>
      )}
    </main>
  );
}
