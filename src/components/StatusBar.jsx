/**
 * StatusBar.jsx
 *
 * Quiet visitor status line with route, floor, and connectivity context.
 */

import { Download, Layers, MapPin, Wifi, WifiOff } from 'lucide-react';
import { useNavigation, NAV_STATUS } from '../context/NavigationContext.jsx';
import { startPointLabel } from '../capture/startLabel.ts';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getOfflineAvailability,
  subscribeOfflineAvailability,
} from '../offline/offlineAvailability.ts';

export default function StatusBar() {
  const { state, venue, checkIn, packageCacheStatus } = useNavigation();
  const { navStatus, activeFloorId, startNodeId } = state;
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const offlineAvailability = useSyncExternalStore(
    subscribeOfflineAvailability,
    getOfflineAvailability,
    getOfflineAvailability,
  );
  const startNode = venue.getNodeById(startNodeId);
  const activeFloor = venue.getFloorById(activeFloorId);
  const labelNames = {
    space: (id) => venue.getSpaceById(id)?.name ?? null,
    floor: (id) => venue.getFloorById(id)?.name ?? null,
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const statusLabel =
    {
      [NAV_STATUS.IDLE]: 'Ready',
      [NAV_STATUS.ROUTING]: 'Computing route...',
      [NAV_STATUS.NAVIGATING]: 'Navigating',
      [NAV_STATUS.ARRIVED]: 'Arrived',
    }[navStatus] || 'Ready';

  const statusDotClass =
    navStatus === NAV_STATUS.NAVIGATING
      ? 'status-dot navigating'
      : navStatus === NAV_STATUS.ARRIVED
        ? 'status-dot active'
        : 'status-dot';

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
      <div className="status-item status-primary">
        <span className={statusDotClass} />
        <span>{statusLabel}</span>
      </div>

      <div className="status-item status-location">
        <MapPin size={11} />
        <span>{startPointLabel(startNode, checkIn, labelNames, 'Starting point not set')}</span>
      </div>

      <div className="status-item status-floor">
        <Layers size={11} />
        <span>{activeFloor?.name ?? 'Floor unavailable'}</span>
      </div>

      <div
        className="status-item status-offline"
        data-offline-state={offlineState}
        role="status"
        aria-live="polite"
        title={`${connectivityLabel}. ${packageCacheStatus.detail}`}
      >
        <ConnectivityIcon size={11} />
        <span>{connectivityLabel}</span>
      </div>
    </aside>
  );
}
