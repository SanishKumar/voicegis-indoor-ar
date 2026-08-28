import { NavigationProvider } from './context/NavigationContext.jsx';
import { VenueProvider, useVenue } from './context/VenueContext.jsx';
import VenueBootstrapState from './components/VenueBootstrapState.jsx';
import VisitorApp from './components/VisitorApp.jsx';

function ActivePublicApplication() {
  const { venue, status, retryBootstrap, useDefaultVenue } = useVenue();
  if (!venue) {
    return (
      <VenueBootstrapState
        status={status}
        retryBootstrap={retryBootstrap}
        useDefaultVenue={useDefaultVenue}
      />
    );
  }

  return (
    <NavigationProvider key={venue.key} venue={venue}>
      <VisitorApp />
    </NavigationProvider>
  );
}

export default function PublicApp() {
  return (
    <VenueProvider>
      <ActivePublicApplication />
    </VenueProvider>
  );
}
