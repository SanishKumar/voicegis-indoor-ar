import { useSyncExternalStore } from 'react';

function subscribe(changed: () => void) {
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return () => {
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
