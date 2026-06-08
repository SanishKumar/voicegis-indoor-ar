/**
 * StatusBar.jsx
 * 
 * Bottom status bar showing navigation state and app info.
 */

import { Navigation, MapPin, Wifi, WifiOff } from 'lucide-react';
import { useNavigation, NAV_STATUS, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { useState, useEffect } from 'react';

export default function StatusBar() {
  const { state } = useNavigation();
  const { navStatus, activeView, startNodeId } = state;
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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

  const statusLabel = {
    [NAV_STATUS.IDLE]: 'Ready',
    [NAV_STATUS.ROUTING]: 'Computing route...',
    [NAV_STATUS.NAVIGATING]: 'Navigating',
    [NAV_STATUS.ARRIVED]: 'Arrived',
  }[navStatus] || 'Ready';

  const statusDotClass = navStatus === NAV_STATUS.NAVIGATING
    ? 'status-dot navigating'
    : navStatus === NAV_STATUS.ARRIVED
      ? 'status-dot active'
      : 'status-dot';

  return (
    <div className="status-bar" id="status-bar">
      {/* Navigation Status */}
      <div className="status-item">
        <span className={statusDotClass} />
        <span>{statusLabel}</span>
      </div>

      {/* Start Location */}
      <div className="status-item">
        <MapPin size={11} />
        <span>Start: {startNodeId?.replace(/-/g, ' ') || 'Not set'}</span>
      </div>

      {/* View */}
      <div className="status-item">
        {activeView === VIEW_TYPE.AR ? (
          <>
            <Navigation size={11} />
            <span>AR Mode</span>
          </>
        ) : (
          <>
            <MapPin size={11} />
            <span>Map Mode</span>
          </>
        )}
      </div>

      {/* Connection */}
      <div className="status-item">
        {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>
    </div>
  );
}
