/**
 * The small plan in the corner of the camera view: the floor being looked at,
 * the route across it, and the visitor with the way they face at the top.
 * It is drawn by hand on a canvas because it has to turn with the phone
 * every frame, which the map's own renderer is far too heavy for.
 */

const ROUTE = '#8ec5ff';
const TRAVELLED = 'rgba(255, 249, 240, 0.42)';
const OUTLINE = 'rgba(255, 249, 240, 0.4)';
const FILLS = {
  room: 'rgba(255, 249, 240, 0.16)',
  corridor: 'rgba(255, 249, 240, 0.07)',
  lobby: 'rgba(255, 249, 240, 0.1)',
  entrance: 'rgba(255, 249, 240, 0.1)',
  service: 'rgba(255, 249, 240, 0.12)',
  restricted: 'rgba(255, 249, 240, 0.1)',
  'vertical-circulation': 'rgba(142, 197, 255, 0.28)',
};
/** Metres across the whole inset. */
const SPAN_METERS = 64;

/** The parts of a floor the inset draws, gathered once per floor. */
export function prepareMiniMap(buildingPackage, floorId) {
  const floor = (buildingPackage?.floors ?? []).find((entry) => entry.id === floorId);
  return {
    outline: floor ? floor.outline : [],
    spaces: (buildingPackage?.spaces ?? [])
      .filter((space) => space.floorId === floorId)
      .map((space) => ({ polygon: space.polygon, fill: FILLS[space.type] ?? FILLS.room })),
  };
}

function polygon(context, points) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }
  context.closePath();
}

function polyline(context, points) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<typeof prepareMiniMap>} prepared
 * @param {{ x: number, y: number, facingDegrees: number, ahead: number[][], behind: number[][] }} view
 */
export function drawMiniMap(canvas, prepared, view) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const size = canvas.clientWidth;
  if (!(size > 0)) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(size * ratio);
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);

  const scale = size / SPAN_METERS;
  const centreX = size / 2;
  // The visitor sits a little below the middle: what is ahead gets the room.
  const centreY = size * 0.6;
  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  context.clip();

  context.translate(centreX, centreY);
  context.rotate((-view.facingDegrees * Math.PI) / 180);
  context.scale(scale, scale);
  context.translate(-view.x, -view.y);
  context.lineJoin = 'round';
  context.lineCap = 'round';

  for (const space of prepared.spaces) {
    polygon(context, space.polygon);
    context.fillStyle = space.fill;
    context.fill();
  }
  context.lineWidth = 0.35;
  context.strokeStyle = OUTLINE;
  for (const space of prepared.spaces) {
    polygon(context, space.polygon);
    context.stroke();
  }
  polygon(context, prepared.outline);
  context.lineWidth = 0.6;
  context.stroke();

  polyline(context, view.behind);
  context.lineWidth = 1.3;
  context.strokeStyle = TRAVELLED;
  context.stroke();
  polyline(context, view.ahead);
  context.lineWidth = 1.5;
  context.strokeStyle = ROUTE;
  context.stroke();
  context.restore();

  // The visitor: a cone for the way they face, and a dot for where they are.
  context.save();
  context.translate(centreX, centreY);
  const cone = context.createLinearGradient(0, 0, 0, -size * 0.34);
  cone.addColorStop(0, 'rgba(142, 197, 255, 0.5)');
  cone.addColorStop(1, 'rgba(142, 197, 255, 0)');
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(-size * 0.17, -size * 0.34);
  context.lineTo(size * 0.17, -size * 0.34);
  context.closePath();
  context.fillStyle = cone;
  context.fill();
  context.beginPath();
  context.arc(0, 0, size * 0.055, 0, Math.PI * 2);
  context.fillStyle = '#fff9f0';
  context.fill();
  context.beginPath();
  context.arc(0, 0, size * 0.038, 0, Math.PI * 2);
  context.fillStyle = '#0a65db';
  context.fill();
  context.restore();
}
