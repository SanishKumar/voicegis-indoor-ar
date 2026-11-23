/**
 * StatusBar.jsx
 *
 * Quiet visitor status line with route, floor, and connectivity context.
 */

import { Download, Layers, Wifi, WifiOff } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useSyncExternalStore } from 'react';
import { useOnline } from '../offline/useOnline';
import {
  getOfflineAvailability,
  subscribeOfflineAvailability,
} from '../offline/offlineAvailability.ts';

export default function StatusBar() {
  const { state, venue, packageCacheStatus } = useNavigation();
  const isOnline = useOnline();
  const offlineAvailability = useSyncExternalStore(
    subscribeOfflineAvailability,
    getOfflineAvailability,
    getOfflineAvailability,
  );
  const activeFloor = venue.getFloorById(state.activeFloorId);

  const offlineReady =
    offlineAvailability === 'available' && packageCacheStatus.state === 'verified';
  const offlineState = offlineReady
    ? 'available'
    : offlineAvailability === 'preparing'
      ? 'preparing'
      : 'online-only';
  const connectivityLabel = !isOnline
    ? offlineReady
      ? 'Working offline'
      : 'No connection'
    : offlineReady
      ? 'Offline ready'
      : offlineAvailability === 'preparing'
        ? 'Saving offline…'
        : 'Online only';
  const ConnectivityIcon = !isOnline ? WifiOff : offlineReady ? Download : Wifi;

  return (
    <aside className="status-bar visitor-status-bar" id="status-bar" aria-label="Map status">
      <div className="status-item status-floor">
        <Layers size={13} aria-hidden="true" />
        <span>{activeFloor?.name ?? 'Floor unavailable'}</span>
      </div>

      <div
        className="status-item status-offline"
        data-offline-state={offlineState}
        role="status"
        aria-live="polite"
        title={`${connectivityLabel}. ${packageCacheStatus.detail}`}
      >
        <ConnectivityIcon size={13} aria-hidden="true" />
        <span>{connectivityLabel}</span>
      </div>
    </aside>
  );
}
