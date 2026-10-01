export type MapGraphicsSetting = 'auto' | 'full' | 'low';
export type MapGraphicsLevel = 'full' | 'low';
export interface MapGraphicsSnapshot {
  setting: MapGraphicsSetting;
  level: MapGraphicsLevel;
  reason: 'default' | 'device-hint' | 'slow-frames' | 'manual';
}
export interface GraphicsHints {
  memoryGiB?: number;
  cores?: number;
}

const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;
const constrained = (hints: GraphicsHints) =>
  (positive(hints.memoryGiB) && hints.memoryGiB <= 2) ||
  (positive(hints.cores) && hints.cores <= 4);

/** Presentation policy only. These provisional limits are not a handset benchmark. */
export function createVisitorRenderQuality(
  hints: GraphicsHints = {},
  previous?: MapGraphicsSnapshot,
) {
  const initialLow = constrained(hints);
  let snapshot: MapGraphicsSnapshot = previous
    ? { ...previous }
    : {
        setting: 'auto',
        level: initialLow ? 'low' : 'full',
        reason: initialLow ? 'device-hint' : 'default',
      };
  let frames = 0;
  let slowFrames = 0;
  let durationMs = 0;
  const resetWindow = () => {
    frames = 0;
    slowFrames = 0;
    durationMs = 0;
  };
  return {
    read: (): MapGraphicsSnapshot => ({ ...snapshot }),
    profile(devicePixelRatio: number) {
      const ratio = positive(devicePixelRatio) ? devicePixelRatio : 1;
      return {
        pixelRatio: Math.min(ratio, snapshot.level === 'low' ? 1 : 2),
        shadows: snapshot.level === 'full',
      };
    },
    setSetting(setting: MapGraphicsSetting) {
      // Selecting Auto is an explicit re-check, even after an automatic
      // downshift. Only the user can restart it; frames cannot oscillate it.
      if (setting === snapshot.setting && setting !== 'auto') return false;
      resetWindow();
      snapshot =
        setting === 'auto'
          ? {
              setting,
              level: initialLow ? 'low' : 'full',
              reason: initialLow ? 'device-hint' : 'default',
            }
          : { setting, level: setting, reason: 'manual' };
      return true;
    },
    /**
     * Only consecutive drawn frames count. Idle time, hidden-tab gaps, one
     * expensive first draw, or an occasional stall must not lower detail.
     * Downshift once; never oscillate quality while somebody is navigating.
     */
    observeFrame(elapsedMs: number, consecutiveDraw: boolean) {
      if (snapshot.setting !== 'auto' || snapshot.level === 'low') return false;
      if (!consecutiveDraw || !Number.isFinite(elapsedMs) || elapsedMs < 4 || elapsedMs > 250) {
        resetWindow();
        return false;
      }
      frames += 1;
      durationMs += elapsedMs;
      if (elapsedMs > 40) slowFrames += 1;
      if (durationMs < 1800 || frames < 20) return false;
      const downshift = slowFrames / frames >= 0.7;
      resetWindow();
      if (!downshift) return false;
      snapshot = { setting: 'auto', level: 'low', reason: 'slow-frames' };
      return true;
    },
  };
}
