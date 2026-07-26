export function formatDistance(meters) {
  if (meters < 1) return '< 1m';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function estimateWalkTime(meters, walkSpeedMps = 1.2) {
  const seconds = meters / walkSpeedMps;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
