/**
 * StatusBar.jsx
 *
 * Quiet visitor status line with route, floor, and connectivity context.
 */

import { MapPin, Wifi, WifiOff, Layers } from 'lucide-react';
import { useNavigation, NAV_STATUS } from '../context/NavigationContext.jsx';
import { useState, useEffect } from 'react';

export default function StatusBar() {
  const { state, venue } = useNavigation();
  const { navStatus, activeFloorId, startNodeId } = state;
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const startNode = venue.getNodeById(startNodeId);
  const activeFloor = venue.getFloorById(activeFloorId);

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

  return (
    <aside className="status-bar visitor-status-bar" id="status-bar" aria-label="Map status">
      <div className="status-item status-primary">
        <span className={statusDotClass} />
        <span>{statusLabel}</span>
      </div>

      <div className="status-item status-location">
        <MapPin size={11} />
        <span>{startNode?.poi?.name || 'Starting point not set'}</span>
      </div>

      <div className="status-item status-floor">
        <Layers size={11} />
        <span>{activeFloor?.name ?? 'Floor unavailable'}</span>
      </div>

      <div className="status-item status-network" title={isOnline ? 'Connected' : 'Offline-ready'}>
        {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
        <span>{isOnline ? 'Connected' : 'Offline-ready'}</span>
      </div>
    </aside>
  );
}
