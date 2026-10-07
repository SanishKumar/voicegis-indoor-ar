import { useState, useSyncExternalStore } from 'react';

const query = '(max-width: 899px)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
};
const snapshot = () => window.matchMedia?.(query).matches ?? false;

/** Presentation only: folding a panel must never stop a route or lose a draft. */
export function useMobilePanel(session: unknown) {
  const mobile = useSyncExternalStore(subscribe, snapshot, () => false);
  const [choice, setChoice] = useState({ session, collapsed: false });
  if (choice.session !== session) setChoice({ session, collapsed: false });
  const collapsed = mobile && choice.session === session && choice.collapsed;
  return {
    mobile,
    collapsed,
    setCollapsed: (value: boolean) => setChoice({ session, collapsed: value }),
  };
}
