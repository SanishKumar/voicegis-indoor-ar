/*
 * What is in a room.
 *
 * From outside, a building on a site is drawn with its windows, its canopy and
 * the cars in its car park. Inside, every room used to hold the same three
 * grey blocks, whatever it was. This furnishes a room by what it is for: beds
 * in a ward, shelving in a pharmacy, a scanner in imaging, tables in a café,
 * lift cars in a lift lobby.
 *
 * It is illustration, not survey. A venue package says what a room is called
 * and what it is for; it does not say where the beds are. So the furniture is
 * laid out by rule from the room's own shape, the same way every time, and
 * four things are never covered: a doorway, a destination's pin, the walls,
 * and any line a drawn route can take through the room. Furniture that would
 * break one of those is left out rather than moved somewhere it might.
 *
 * Nothing here is used for routing, clearance or position, and nothing here
 * knows about a renderer: a room goes in, a list of plain solids comes out.
 */

import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { insetPolygon, type Point } from './softGeometry';

export type FurnitureShape = 'box' | 'cylinder' | 'sphere' | 'ring';

export interface FurniturePart {
  /** What it is a part of: "bed", "shelf", "lift". For tests and for reading a scene. */
  item: string;
  shape: FurnitureShape;
  /** Centre, in plan metres. */
  position: Point;
  /** Height of its centre above the floor. */
  elevation: number;
  /** Extent along plan x, along plan y, and upward. A sphere or ring uses the first as its diameter. */
  size: readonly [number, number, number];
  /** A ring stands with its opening along plan y; turned, along plan x. */
  turned: boolean;
  color: number;
}

export interface RoomToFurnish {
  id: string;
  name: string;
  /** The package's space type: room, lobby, corridor, vertical-circulation and so on. */
  type: string;
  polygon: readonly Point[];
  /** Names and categories of the places in the room: what the room is for. */
  purposes: readonly string[];
  /** Pins and connector stops, kept clear. */
  pins: readonly Point[];
  doors: readonly { position: Point; width: number }[];
  /** Every line a drawn route can take through the room. */
  lanes: readonly (readonly [Point, Point])[];
}

/*
 * The palette is the model's own: whites and pale blues, one slate, a sand
 * and a sage. Furniture is scenery, so it stays quieter than the route and
 * the pins, which are the only saturated things on a floor.
 */
const WHITE = 0xf6f8fc;
const LINEN = 0xe6ecf4;
const MIST = 0xcbd8ea;
const SKY = 0xa9c4e8;
const SLATE = 0x8499b6;
const DEEP = 0x61769a;
const SAND = 0xe4dccf;
const SAGE = 0x9fc3b4;
const WATER = 0x8ec7f7;

/** Furniture is drawn lower than life, so a shelf does not stand in front of the route behind it. */
const HEIGHT_SCALE = 0.72;
/** How far a piece keeps from a wall. */
const WALL_MARGIN = 0.5;
/** How far a piece keeps from the middle of any line a route can take. */
const LANE_CLEARANCE = 0.95;
/** How far a piece keeps from a pin. */
const PIN_CLEARANCE = 0.8;
/** The least gap between two pieces. */
const PIECE_GAP = 0.25;

type LocalPart = {
  shape: FurnitureShape;
  /** Across, towards the front, and up, from the middle of the piece on the floor. */
  at: readonly [number, number, number];
  size: readonly [number, number, number];
  color: number;
};

interface Piece {
  name: string;
  /** Its footprint: across, and from back to front. The back goes to a wall. */
  width: number;
  depth: number;
  parts: readonly LocalPart[];
}

const box = (
  at: LocalPart['at'],
  size: LocalPart['size'],
  color: number,
  shape: FurnitureShape = 'box',
): LocalPart => ({ shape, at, size, color });
const cylinder = (at: LocalPart['at'], diameter: number, height: number, color: number) =>
  box(at, [diameter, diameter, height], color, 'cylinder');

/** Positions for so many things at a pitch, centred on zero. */
const spaced = (count: number, pitch: number) =>
  Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * pitch);

/* The pieces. Local y runs from the back of a piece (negative) to its front. */

const bed: Piece = {
  name: 'bed',
  width: 1.9,
  depth: 2.15,
  parts: [
    box([-0.3, 0, 0.21], [0.95, 2.0, 0.42], LINEN),
    box([-0.3, 0.3, 0.46], [0.9, 1.3, 0.1], SKY),
    box([-0.3, -0.72, 0.47], [0.6, 0.36, 0.1], WHITE),
    box([-0.3, -1.0, 0.42], [0.98, 0.08, 0.84], MIST),
    // The cabinet beside it, and the curtain that makes a bay of it.
    box([0.5, -0.78, 0.26], [0.42, 0.42, 0.52], WHITE),
    box([0.9, -0.1, 0.62], [0.05, 1.9, 1.24], MIST),
  ],
};

const recliner: Piece = {
  name: 'recliner',
  width: 1.7,
  depth: 1.5,
  parts: [
    box([-0.3, 0.08, 0.22], [0.78, 1.3, 0.44], SKY),
    box([-0.3, -0.6, 0.62], [0.78, 0.2, 0.8], SKY),
    // The machine it is there for.
    box([0.5, -0.45, 0.52], [0.42, 0.42, 1.04], SLATE),
    box([0.5, -0.45, 1.1], [0.3, 0.06, 0.2], DEEP),
  ],
};

const desk: Piece = {
  name: 'desk',
  width: 1.6,
  depth: 1.45,
  parts: [
    box([0, -0.36, 0.36], [1.5, 0.7, 0.72], LINEN),
    box([0, -0.52, 0.88], [0.5, 0.06, 0.32], DEEP),
    cylinder([0, 0.38, 0.23], 0.5, 0.46, SLATE),
  ],
};

/** Two desks back to back, as an office is laid out. */
const deskPair: Piece = {
  name: 'desk',
  width: 1.6,
  depth: 2.6,
  parts: [
    box([0, -0.36, 0.36], [1.5, 0.7, 0.72], LINEN),
    box([0, 0.36, 0.36], [1.5, 0.7, 0.72], LINEN),
    box([0, -0.06, 0.88], [0.5, 0.06, 0.32], DEEP),
    box([0, 0.06, 0.88], [0.5, 0.06, 0.32], DEEP),
    cylinder([0, -1.02, 0.23], 0.5, 0.46, SLATE),
    cylinder([0, 1.02, 0.23], 0.5, 0.46, SLATE),
  ],
};

const counter = (length: number): Piece => ({
  name: 'counter',
  width: length,
  depth: 1.5,
  parts: [
    box([0, -0.25, 0.48], [length, 0.7, 0.96], LINEN),
    box([0, -0.25, 0.99], [length + 0.12, 0.82, 0.06], WHITE),
    // A screen and a seat for each person serving at it.
    ...spaced(Math.max(1, Math.floor(length / 1.5)), 1.5).flatMap((x) => [
      box([x, -0.3, 1.16], [0.44, 0.06, 0.28], DEEP),
      cylinder([x, -0.62, 0.23], 0.46, 0.46, SLATE),
    ]),
  ],
});

const seatRow = (seats: number): Piece => ({
  name: 'seats',
  width: seats * 0.58,
  depth: 0.72,
  parts: [
    box([0, 0.06, 0.2], [seats * 0.58, 0.55, 0.4], SKY),
    box([0, -0.27, 0.48], [seats * 0.58, 0.1, 0.5], SLATE),
    ...spaced(seats - 1, 0.58).map((x) => box([x, 0.06, 0.43], [0.05, 0.5, 0.1], MIST)),
  ],
});

const shelf = (length: number): Piece => ({
  name: 'shelf',
  width: length,
  depth: 0.6,
  parts: [
    box([0, 0, 0.62], [length, 0.42, 1.24], LINEN),
    // Two stocked shelves, standing a little proud of the carcass.
    box([0, 0.04, 0.5], [length - 0.12, 0.46, 0.2], SKY),
    box([0, 0.04, 0.92], [length - 0.12, 0.46, 0.2], MIST),
    box([0, 0, 1.27], [length + 0.06, 0.5, 0.06], WHITE),
  ],
});

/** A run of shelving stocked on both sides, to stand in the middle of a floor. */
const shelfIsland = (length: number): Piece => ({
  name: 'shelf',
  width: length,
  depth: 0.9,
  parts: [
    box([0, 0, 0.58], [length, 0.7, 1.16], LINEN),
    box([0, 0, 0.46], [length - 0.12, 0.84, 0.2], SKY),
    box([0, 0, 0.86], [length - 0.12, 0.84, 0.2], MIST),
    box([0, 0, 1.19], [length + 0.06, 0.78, 0.06], WHITE),
  ],
});

const cafeTable: Piece = {
  name: 'table',
  width: 1.9,
  depth: 1.9,
  parts: [
    cylinder([0, 0, 0.55], 0.92, 0.06, WHITE),
    cylinder([0, 0, 0.27], 0.14, 0.52, SLATE),
    cylinder([0.66, 0, 0.17], 0.38, 0.34, SAND),
    cylinder([-0.66, 0, 0.17], 0.38, 0.34, SAND),
    cylinder([0, 0.66, 0.17], 0.38, 0.34, SAND),
    cylinder([0, -0.66, 0.17], 0.38, 0.34, SAND),
  ],
};

const scanner: Piece = {
  name: 'scanner',
  width: 2.4,
  depth: 3.5,
  parts: [
    // The ring a patient is moved through, and the table that moves them.
    box([0, -0.7, 1.05], [2.1, 0.62, 2.1], WHITE, 'ring'),
    box([0, -0.7, 0.16], [2.2, 0.9, 0.32], LINEN),
    box([0, 0.55, 0.3], [0.56, 2.3, 0.6], LINEN),
    box([0, 0.55, 0.63], [0.66, 2.2, 0.08], SKY),
  ],
};

const examCouch: Piece = {
  name: 'couch',
  width: 0.9,
  depth: 2.0,
  parts: [
    box([0, 0, 0.3], [0.62, 1.8, 0.6], LINEN),
    box([0, 0, 0.64], [0.7, 1.9, 0.08], SKY),
    box([0, -0.72, 0.71], [0.5, 0.34, 0.08], WHITE),
  ],
};

/** A consulting bay: a desk with a couch beside it and a curtain between bays. */
const consultingBay: Piece = {
  name: 'consulting bay',
  width: 3.3,
  depth: 2.1,
  parts: [
    box([-0.75, -0.66, 0.36], [1.5, 0.7, 0.72], LINEN),
    box([-0.75, -0.82, 0.88], [0.5, 0.06, 0.32], DEEP),
    cylinder([-0.75, 0.06, 0.23], 0.5, 0.46, SLATE),
    box([0.8, 0, 0.3], [0.62, 1.8, 0.6], LINEN),
    box([0.8, 0, 0.64], [0.7, 1.9, 0.08], SKY),
    box([0.8, -0.72, 0.71], [0.5, 0.34, 0.08], WHITE),
    box([1.58, -0.1, 0.62], [0.05, 1.9, 1.24], MIST),
  ],
};

const labBench = (length: number): Piece => ({
  name: 'bench',
  width: length,
  depth: 1.35,
  parts: [
    box([0, -0.28, 0.44], [length, 0.76, 0.88], WHITE),
    // What stands on it, and a stool for each place at it.
    ...spaced(Math.max(1, Math.floor(length / 0.8)), 0.8).map((x, index) =>
      box(
        [x, -0.34, 1.02],
        [0.36, 0.36, index % 2 === 0 ? 0.28 : 0.44],
        index % 2 === 0 ? SLATE : SKY,
      ),
    ),
    ...spaced(Math.max(1, Math.floor(length / 1.2)), 1.2).map((x) =>
      cylinder([x, 0.42, 0.26], 0.4, 0.52, SLATE),
    ),
  ],
});

const treadmill: Piece = {
  name: 'treadmill',
  width: 0.95,
  depth: 1.9,
  parts: [
    box([0, 0.05, 0.12], [0.78, 1.7, 0.24], DEEP),
    box([0, -0.74, 0.62], [0.72, 0.1, 0.76], SLATE),
    box([0, -0.74, 1.04], [0.76, 0.3, 0.1], LINEN),
  ],
};

const exerciseBike: Piece = {
  name: 'bike',
  width: 0.8,
  depth: 1.4,
  parts: [
    box([0, 0, 0.14], [0.5, 1.2, 0.28], DEEP),
    cylinder([0, 0.3, 0.56], 0.34, 0.2, SLATE),
    box([0, -0.42, 0.62], [0.56, 0.08, 0.7], SLATE),
  ],
};

const mat = (color: number): Piece => ({
  name: 'mat',
  width: 0.85,
  depth: 1.95,
  parts: [box([0, 0, 0.03], [0.72, 1.8, 0.06], color)],
});

const ball: Piece = {
  name: 'ball',
  width: 0.75,
  depth: 0.75,
  parts: [box([0, 0, 0.42], [0.62, 0.62, 0.62], MIST, 'sphere')],
};

const liftCar: Piece = {
  name: 'lift',
  width: 2.1,
  depth: 1.9,
  parts: [
    box([0, -0.05, 0.9], [1.9, 1.7, 1.8], MIST),
    // Two door leaves and the frame round them.
    box([-0.31, 0.83, 0.78], [0.58, 0.06, 1.56], DEEP),
    box([0.31, 0.83, 0.78], [0.58, 0.06, 1.56], DEEP),
    box([0, 0.84, 1.64], [1.5, 0.1, 0.14], WHITE),
    // The call button beside it.
    box([0.92, 0.84, 0.8], [0.12, 0.08, 0.26], WHITE),
  ],
};

const stairFlight: Piece = {
  name: 'stairs',
  width: 3.1,
  depth: 3.1,
  parts: [
    // Up one side to a half landing, and back down the other.
    ...Array.from({ length: 7 }, (_, index) =>
      box(
        [-0.78, 1.36 - index * 0.32, 0.09 + index * 0.09],
        [1.4, 0.32, 0.18 + index * 0.18],
        WHITE,
      ),
    ),
    box([0, -1.22, 0.72], [3.0, 0.6, 1.44], LINEN),
    ...Array.from({ length: 5 }, (_, index) =>
      box(
        [0.78, -0.76 + index * 0.32, 1.53 + index * 0.09],
        [1.4, 0.32, 0.18 + index * 0.18],
        MIST,
      ),
    ),
    box([0, 0.2, 0.9], [0.1, 2.3, 1.8], SLATE),
  ],
};

const sofa: Piece = {
  name: 'sofa',
  width: 2.0,
  depth: 0.95,
  parts: [
    box([0, 0.1, 0.21], [1.8, 0.7, 0.42], SKY),
    box([0, -0.32, 0.42], [1.8, 0.18, 0.84], SLATE),
    box([-0.95, 0.06, 0.3], [0.14, 0.78, 0.6], SLATE),
    box([0.95, 0.06, 0.3], [0.14, 0.78, 0.6], SLATE),
  ],
};

const lowTable: Piece = {
  name: 'table',
  width: 1.1,
  depth: 0.7,
  parts: [box([0, 0, 0.19], [0.95, 0.55, 0.38], SAND)],
};

const plant: Piece = {
  name: 'plant',
  width: 0.75,
  depth: 0.75,
  parts: [
    cylinder([0, 0, 0.24], 0.5, 0.48, MIST),
    box([0, 0, 0.78], [0.72, 0.72, 0.84], SAGE, 'sphere'),
  ],
};

const planterBox: Piece = {
  name: 'planter',
  width: 2.4,
  depth: 0.8,
  parts: [
    box([0, 0, 0.26], [2.3, 0.7, 0.52], SAND),
    box([-0.72, 0, 0.74], [0.7, 0.7, 0.62], SAGE, 'sphere'),
    box([0, 0, 0.8], [0.76, 0.76, 0.74], SAGE, 'sphere'),
    box([0.72, 0, 0.72], [0.66, 0.66, 0.58], SAGE, 'sphere'),
  ],
};

const screen: Piece = {
  name: 'screen',
  width: 2.6,
  depth: 0.3,
  parts: [
    box([0, -0.06, 1.2], [2.4, 0.08, 1.1], DEEP),
    box([0, -0.06, 1.2], [2.5, 0.05, 1.2], WHITE),
  ],
};

const cabinet: Piece = {
  name: 'cabinet',
  width: 1.0,
  depth: 0.55,
  parts: [
    box([0, 0, 0.55], [0.95, 0.45, 1.1], LINEN),
    box([0, 0.2, 0.55], [0.04, 0.06, 1.0], MIST),
  ],
};

const lounger: Piece = {
  name: 'lounger',
  width: 0.85,
  depth: 2.0,
  parts: [
    box([0, 0.2, 0.16], [0.7, 1.5, 0.32], WHITE),
    box([0, -0.68, 0.34], [0.7, 0.5, 0.5], WHITE),
  ],
};

type Wall = 'minY' | 'maxY' | 'minX' | 'maxX';
/** Quarter turns that put a piece's back to each wall and its front into the room. */
const FACING: Record<Wall, 0 | 1 | 2 | 3> = { minY: 0, maxX: 1, maxY: 2, minX: 3 };

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function pointInPolygon([x, y]: Point, polygon: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a line crosses a rectangle, by clipping the line to it. */
function segmentCrossesRect([a, b]: readonly [Point, Point], rect: Rect) {
  let from = 0;
  let to = 1;
  const clip = (delta: number, start: number, low: number, high: number) => {
    if (Math.abs(delta) < 1e-9) return start >= low && start <= high;
    let near = (low - start) / delta;
    let far = (high - start) / delta;
    if (near > far) [near, far] = [far, near];
    from = Math.max(from, near);
    to = Math.min(to, far);
    return from <= to;
  };
  return (
    clip(b[0] - a[0], a[0], rect.minX, rect.maxX) && clip(b[1] - a[1], a[1], rect.minY, rect.maxY)
  );
}

const grown = (rect: Rect, by: number): Rect => ({
  minX: rect.minX - by,
  minY: rect.minY - by,
  maxX: rect.maxX + by,
  maxY: rect.maxY + by,
});
const holds = (rect: Rect, [x, y]: Point) =>
  x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
const overlaps = (a: Rect, b: Rect) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

/** What a room is for, read from its name and the places in it. */
export type RoomUse =
  | 'lifts'
  | 'stairs'
  | 'pool'
  | 'gym'
  | 'studio'
  | 'retail'
  | 'cafe'
  | 'imaging'
  | 'office'
  | 'laboratory'
  | 'ward'
  | 'infusion'
  | 'front-desk'
  | 'classroom'
  | 'lounge'
  | 'terrace'
  | 'clinic'
  | 'lobby'
  | 'concourse'
  | 'plain'
  | 'empty';

/*
 * Words are matched from their start and not to their end, so "pharmacy" and
 * "pharmacies" are one word here and "café" does not depend on what a regular
 * expression thinks of an accent. The order is the order of precedence: a
 * "Clinical Research Office" is an office before it is a clinic.
 */
const USES: ReadonlyArray<readonly [RegExp, RoomUse]> = [
  [/\b(hydro|pool\b)/, 'pool'],
  [/\b(gym|fitness)/, 'gym'],
  [/\bstudio/, 'studio'],
  [/\b(pharmac|shop\b|store\b|gift|retail|kiosk)/, 'retail'],
  [/\b(caf|food|restaurant|canteen|dining|coffee)/, 'cafe'],
  [/\b(imaging|radiolog|mri\b|x-?ray|scanner)/, 'imaging'],
  [/\b(office|administration|records|research)/, 'office'],
  [/\b(laborator|blood|patholog)/, 'laboratory'],
  [/\b(dialysis|oncology|infusion|chemo)/, 'infusion'],
  [
    /\b(ward\b|recovery|maternity|birth|neonatal|nicu\b|pediatric|paediatric|children|surgery|treatment|injur|intensive|inpatient)/,
    'ward',
  ],
  [/\b(registration|reception|information|admission|triage|help ?desk|check-?in)/, 'front-desk'],
  [/\b(education|training|lecture|conference|seminar|classroom|meeting)/, 'classroom'],
  [/\b(waiting|lounge|quiet|family|chapel|prayer)/, 'lounge'],
  [/\b(terrace|garden|atrium)/, 'terrace'],
  [
    /\b(therap|physio|clinic|cardiolog|health|consult|exam|ultrasound|dental|medical|diagnostic)/,
    'clinic',
  ],
  // What a department is, not what a room in it is: its waiting area is a
  // lounge and its triage a desk. Only failing all of those is it a ward.
  [/\bemergency/, 'ward'],
];

export function roomUse(room: Pick<RoomToFurnish, 'name' | 'type' | 'purposes'>): RoomUse {
  const name = room.name.toLowerCase();
  if (room.type === 'vertical-circulation') {
    if (/\b(lift|elevator)s?\b/.test(name)) return 'lifts';
    if (/\bstair/.test(name)) return 'stairs';
    return 'empty';
  }
  if (room.type === 'corridor') return 'concourse';
  // The room's own name says more than the category of a place in it: a
  // café's is "food", but so is the vending machine in a waiting room.
  for (const text of [name, room.purposes.join(' ').toLowerCase()]) {
    for (const [pattern, use] of USES) if (pattern.test(text)) return use;
  }
  if (room.type === 'lobby' || room.type === 'entrance') return 'lobby';
  if (room.type === 'service') return 'front-desk';
  return 'plain';
}

/** The furniture of one room, as plain solids in plan coordinates. */
export function furnishRoom(room: RoomToFurnish): FurniturePart[] {
  const polygon = room.polygon;
  if (polygon.length < 3) return [];
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  const bounds: Rect = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
  const across = bounds.maxX - bounds.minX;
  const down = bounds.maxY - bounds.minY;
  // Too small to hold anything and still be walked through.
  if (across < 3 || down < 3) return [];
  // A little inside the margin pieces are set to, so one standing exactly on
  // it counts as inside whichever wall it is against.
  const interior = insetPolygon(polygon, WALL_MARGIN - 0.05);
  const parts: FurniturePart[] = [];
  const taken: Rect[] = [];

  const free = (rect: Rect) => {
    const corners: Point[] = [
      [rect.minX, rect.minY],
      [rect.maxX, rect.minY],
      [rect.maxX, rect.maxY],
      [rect.minX, rect.maxY],
      [(rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2],
    ];
    if (!corners.every((corner) => pointInPolygon(corner, interior))) return false;
    if (taken.some((other) => overlaps(grown(rect, PIECE_GAP), other))) return false;
    const lane = grown(rect, LANE_CLEARANCE);
    if (room.lanes.some((segment) => segmentCrossesRect(segment, lane))) return false;
    const pin = grown(rect, PIN_CLEARANCE);
    if (room.pins.some((point) => holds(pin, point))) return false;
    // A doorway is kept clear for its own width and a stride beyond.
    return !room.doors.some((door) => holds(grown(rect, door.width / 2 + 0.9), door.position));
  };

  /** Puts a piece down with its middle at a point, or does not. */
  const put = (piece: Piece, x: number, y: number, turns: 0 | 1 | 2 | 3) => {
    const sideways = turns % 2 === 1;
    const halfX = (sideways ? piece.depth : piece.width) / 2;
    const halfY = (sideways ? piece.width : piece.depth) / 2;
    const rect: Rect = { minX: x - halfX, minY: y - halfY, maxX: x + halfX, maxY: y + halfY };
    if (!free(rect)) return false;
    taken.push(rect);
    for (const part of piece.parts) {
      const [lx, ly, lz] = part.at;
      // A quarter turn at a time: (x, y) -> (-y, x).
      const [dx, dy] =
        turns === 0 ? [lx, ly] : turns === 1 ? [-ly, lx] : turns === 2 ? [-lx, -ly] : [ly, -lx];
      // A ring is a diameter and a thickness, turned as a whole; it stands on
      // the floor, so its diameter comes down with its height.
      const ring = part.shape === 'ring';
      parts.push({
        item: piece.name,
        shape: part.shape,
        position: [x + dx, y + dy],
        elevation: lz * HEIGHT_SCALE,
        size: ring
          ? [part.size[0] * HEIGHT_SCALE, part.size[1], part.size[2] * HEIGHT_SCALE]
          : [
              sideways ? part.size[1] : part.size[0],
              sideways ? part.size[0] : part.size[1],
              part.size[2] * HEIGHT_SCALE,
            ],
        turned: sideways,
        color: part.color,
      });
    }
    return true;
  };

  const wallOf = (door: Point): Wall | null => {
    const distances: Array<[Wall, number]> = [
      ['minY', Math.abs(door[1] - bounds.minY)],
      ['maxY', Math.abs(door[1] - bounds.maxY)],
      ['minX', Math.abs(door[0] - bounds.minX)],
      ['maxX', Math.abs(door[0] - bounds.maxX)],
    ];
    const [wall, distance] = distances.reduce((a, b) => (a[1] <= b[1] ? a : b));
    return distance < 0.8 ? wall : null;
  };
  const doorWalls = new Set(room.doors.map((door) => wallOf(door.position)).filter(Boolean));
  const length = (wall: Wall) => (wall === 'minY' || wall === 'maxY' ? across : down);
  const walls: Wall[] = ['minY', 'maxY', 'minX', 'maxX'];
  /** Walls with no door in them, longest first; every wall, if they all have one. */
  const solid = walls
    .filter((wall) => !doorWalls.has(wall))
    .sort((a, b) => length(b) - length(a) || walls.indexOf(a) - walls.indexOf(b));
  const backs = solid.length > 0 ? solid : [...walls].sort((a, b) => length(b) - length(a));
  /** The wall opposite the room's first door, where a visitor coming in looks. */
  const firstDoor = room.doors[0] ? wallOf(room.doors[0].position) : null;
  const opposite: Record<Wall, Wall> = { minY: 'maxY', maxY: 'minY', minX: 'maxX', maxX: 'minX' };
  const facing = firstDoor ? opposite[firstDoor] : backs[0];

  /** A row of a piece along a wall, backs to it. Returns how many went in. */
  const along = (wall: Wall, piece: Piece, gap: number, limit = Infinity, start = 0) => {
    const horizontal = wall === 'minY' || wall === 'maxY';
    const run = horizontal ? across : down;
    const from = (horizontal ? bounds.minX : bounds.minY) + WALL_MARGIN + piece.width / 2 + start;
    const until = (horizontal ? bounds.maxX : bounds.maxY) - WALL_MARGIN - piece.width / 2;
    const offset = WALL_MARGIN + piece.depth / 2;
    let count = 0;
    // Spread evenly over the wall, not packed against one end of it.
    const fit = Math.max(
      1,
      Math.floor((run - 2 * WALL_MARGIN - start + gap) / (piece.width + gap)),
    );
    const spread = fit > 1 ? (until - from) / (fit - 1) : 0;
    for (let index = 0; index < fit && count < limit; index += 1) {
      const t = fit > 1 ? from + index * spread : (from + until) / 2;
      const placed =
        wall === 'minY'
          ? put(piece, t, bounds.minY + offset, FACING.minY)
          : wall === 'maxY'
            ? put(piece, t, bounds.maxY - offset, FACING.maxY)
            : wall === 'minX'
              ? put(piece, bounds.minX + offset, t, FACING.minX)
              : put(piece, bounds.maxX - offset, t, FACING.maxX);
      if (placed) count += 1;
    }
    return count;
  };

  /** One of a piece in the middle of a wall, or as near the middle as is free. */
  const centred = (wall: Wall, piece: Piece) => {
    const horizontal = wall === 'minY' || wall === 'maxY';
    const middle = horizontal ? (bounds.minX + bounds.maxX) / 2 : (bounds.minY + bounds.maxY) / 2;
    const reach = (horizontal ? across : down) / 2 - WALL_MARGIN - piece.width / 2;
    const offset = WALL_MARGIN + piece.depth / 2;
    for (let step = 0; step <= reach; step += 0.5) {
      for (const t of step === 0 ? [middle] : [middle - step, middle + step]) {
        const placed =
          wall === 'minY'
            ? put(piece, t, bounds.minY + offset, FACING.minY)
            : wall === 'maxY'
              ? put(piece, t, bounds.maxY - offset, FACING.maxY)
              : wall === 'minX'
                ? put(piece, bounds.minX + offset, t, FACING.minX)
                : put(piece, bounds.maxX - offset, t, FACING.maxX);
        if (placed) return true;
      }
    }
    return false;
  };

  /** A grid of a piece across the floor, clear of the walls. */
  const fill = (
    piece: Piece,
    gapX: number,
    gapY: number,
    limit: number,
    turns: 0 | 1 | 2 | 3 = 0,
    margin = 1.5,
  ) => {
    const sideways = turns % 2 === 1;
    const w = sideways ? piece.depth : piece.width;
    const d = sideways ? piece.width : piece.depth;
    const columns = Math.floor((across - 2 * margin + gapX) / (w + gapX));
    const rows = Math.floor((down - 2 * margin + gapY) / (d + gapY));
    if (columns < 1 || rows < 1) return 0;
    const startX = (bounds.minX + bounds.maxX) / 2 - ((columns - 1) * (w + gapX)) / 2;
    const startY = (bounds.minY + bounds.maxY) / 2 - ((rows - 1) * (d + gapY)) / 2;
    let count = 0;
    for (let row = 0; row < rows && count < limit; row += 1) {
      for (let column = 0; column < columns && count < limit; column += 1) {
        if (put(piece, startX + column * (w + gapX), startY + row * (d + gapY), turns)) count += 1;
      }
    }
    return count;
  };

  /** One of a piece as near the middle of the room as is free. */
  const middle = (piece: Piece, turns: 0 | 1 | 2 | 3 = 0) => {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    for (let ring = 0; ring <= 5; ring += 1) {
      const step = ring * 1.1;
      const offsets: Point[] =
        ring === 0
          ? [[0, 0]]
          : [
              [step, 0],
              [-step, 0],
              [0, step],
              [0, -step],
              [step, step],
              [-step, step],
              [step, -step],
              [-step, -step],
            ];
      for (const [dx, dy] of offsets) if (put(piece, cx + dx, cy + dy, turns)) return true;
    }
    return false;
  };

  /** A piece in each corner that has room for one. */
  const corners = (piece: Piece, limit = 4) => {
    const inset = WALL_MARGIN + piece.width / 2 + 0.1;
    let count = 0;
    for (const [x, y] of [
      [bounds.minX + inset, bounds.minY + inset],
      [bounds.maxX - inset, bounds.maxY - inset],
      [bounds.maxX - inset, bounds.minY + inset],
      [bounds.minX + inset, bounds.maxY - inset],
    ] as Point[]) {
      if (count < limit && put(piece, x, y, 0)) count += 1;
    }
    return count;
  };

  /**
   * One large thing that takes whatever clear part of the floor is biggest:
   * a pool. The room is cut along its routes into the pieces they leave, and
   * the largest that is free is used, shrunk until it fits.
   */
  const basin = (name: string, color: number, rim: number) => {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const edge = WALL_MARGIN + 1.1;
    const regions: Rect[] = [
      { minX: bounds.minX + edge, minY: bounds.minY + edge, maxX: bounds.maxX - edge, maxY: cy },
      { minX: bounds.minX + edge, minY: cy, maxX: bounds.maxX - edge, maxY: bounds.maxY - edge },
      { minX: bounds.minX + edge, minY: bounds.minY + edge, maxX: cx, maxY: bounds.maxY - edge },
      { minX: cx, minY: bounds.minY + edge, maxX: bounds.maxX - edge, maxY: bounds.maxY - edge },
    ];
    let best: Rect | null = null;
    for (const region of regions) {
      for (const shrink of [0, 0.6, 1.2, 1.8, 2.6, 3.4]) {
        const rect = grown(region, -shrink);
        if (rect.maxX - rect.minX < 3 || rect.maxY - rect.minY < 3) break;
        if (!free(rect)) continue;
        const area = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
        if (best === null || area > (best.maxX - best.minX) * (best.maxY - best.minY)) best = rect;
        break;
      }
    }
    if (best === null) return false;
    taken.push(best);
    const w = best.maxX - best.minX;
    const d = best.maxY - best.minY;
    const at: Point = [(best.minX + best.maxX) / 2, (best.minY + best.maxY) / 2];
    const slab = (size: FurniturePart['size'], elevation: number, tint: number, shift: Point) =>
      parts.push({
        item: name,
        shape: 'box',
        position: [at[0] + shift[0], at[1] + shift[1]],
        elevation,
        size,
        turned: false,
        color: tint,
      });
    slab([w, d, 0.2], 0.1, rim, [0, 0]);
    slab([w - 0.7, d - 0.7, 0.06], 0.22, color, [0, 0]);
    // The steps in, at one corner.
    slab([1.2, 0.5, 0.1], 0.26, rim, [-(w - 0.7) / 2 + 0.7, -(d - 0.7) / 2 + 0.3]);
    return true;
  };

  const use = roomUse(room);
  switch (use) {
    case 'lifts':
      along(facing, liftCar, 0.35, 3);
      break;
    case 'stairs':
      if (!centred(facing, stairFlight)) centred(backs[0], stairFlight);
      break;
    case 'pool':
      basin('pool', WATER, WHITE);
      for (const wall of backs.slice(0, 2)) along(wall, lounger, 0.9, 4);
      corners(plant);
      break;
    case 'gym':
      along(backs[0], treadmill, 0.5, 6);
      if (backs[1]) along(backs[1], exerciseBike, 0.7, 5);
      fill(mat(SKY), 0.7, 0.7, 6);
      corners(ball, 2);
      break;
    case 'studio':
      centred(facing, screen);
      fill(mat(SAGE), 0.9, 0.8, 12);
      corners(ball, 2);
      break;
    case 'retail':
      for (const wall of backs.slice(0, 2)) along(wall, shelf(2.4), 0.25);
      middle(counter(2.4), FACING[facing]);
      fill(shelfIsland(2.2), 1.5, 1.7, 4);
      break;
    case 'cafe':
      centred(backs[0], counter(3.2));
      fill(cafeTable, 0.6, 0.6, 12, 0, 1.3);
      corners(plant);
      break;
    case 'imaging':
      middle(scanner, FACING[facing]);
      along(backs[0], desk, 1.0, 2);
      if (backs[1]) along(backs[1], examCouch, 1.4, 2);
      corners(plant, 2);
      break;
    case 'office':
      fill(deskPair, 1.3, 1.4, 8);
      along(backs[0], cabinet, 0.15, 6);
      corners(plant, 2);
      break;
    case 'laboratory':
      for (const wall of backs.slice(0, 2)) along(wall, labBench(2.4), 0.5);
      fill(labBench(2.4), 1.4, 1.5, 4);
      break;
    case 'ward':
      for (const wall of backs.slice(0, 2)) along(wall, bed, 0.5);
      middle(desk, FACING[facing]);
      corners(plant, 2);
      break;
    case 'infusion':
      for (const wall of backs.slice(0, 2)) along(wall, recliner, 0.7);
      middle(desk, FACING[facing]);
      corners(plant, 2);
      break;
    case 'front-desk':
      if (!centred(facing, counter(3.2))) centred(backs[0], counter(3.2));
      fill(seatRow(4), 1.2, 1.3, 6);
      corners(plant);
      break;
    case 'classroom':
      centred(facing, screen);
      fill(seatRow(4), 0.9, 0.8, 9, FACING[opposite[facing]]);
      corners(plant, 2);
      break;
    case 'lounge':
      for (const wall of backs.slice(0, 2)) along(wall, sofa, 1.3, 3);
      fill(lowTable, 2.6, 2.4, 4);
      corners(plant);
      break;
    case 'terrace':
      for (const wall of backs.slice(0, 2)) along(wall, planterBox, 1.2, 4);
      fill(cafeTable, 1.2, 1.0, 6, 0, 2);
      break;
    case 'clinic':
      along(backs[0], consultingBay, 0.6);
      if (backs[1]) along(backs[1], examCouch, 1.5, 3);
      fill(seatRow(3), 1.6, 1.6, 2);
      corners(plant, 2);
      break;
    case 'lobby':
      if (!centred(facing, counter(3.6))) centred(backs[0], counter(3.6));
      fill(seatRow(4), 1.6, 1.6, 6, 0, 2.2);
      corners(plant);
      break;
    case 'concourse': {
      // Only a concourse wide enough to sit in. A bench and a plant by turns
      // down each side, wherever there is wall between the doors.
      if (Math.min(across, down) < 5.5) break;
      const sides: Wall[] = across >= down ? ['minY', 'maxY'] : ['minX', 'maxX'];
      for (const [index, side] of sides.entries()) {
        along(side, seatRow(3), 9, Infinity, index * 5);
        along(side, plant, 10, Infinity, 4.5 + index * 5);
      }
      break;
    }
    case 'plain':
      along(backs[0], sofa, 1.4, 2);
      corners(plant, 2);
      break;
    case 'empty':
      break;
  }
  return parts;
}

/**
 * The rooms of one floor of a venue, each with what its furniture has to keep
 * clear of: its doors, its pins and connector stops, and every line the
 * routing graph can draw a route along inside it.
 */
export function roomsOfFloor(
  buildingPackage: CompiledBuildingPackage,
  floorId: string,
): RoomToFurnish[] {
  const at = new Map(
    buildingPackage.routing.nodes.map((node) => [node.id, node.position as unknown as Point]),
  );
  const lanes = new Map<string, Array<[Point, Point]>>();
  for (const edge of buildingPackage.routing.edges) {
    if (edge.kind !== 'within-space' || edge.spaceId === undefined) continue;
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const inSpace = lanes.get(edge.spaceId) ?? [];
    inSpace.push([from, to]);
    lanes.set(edge.spaceId, inSpace);
  }
  return buildingPackage.spaces
    .filter((space) => space.floorId === floorId)
    .map((space) => {
      const places = buildingPackage.pois.filter(
        (poi) => poi.floorId === floorId && poi.spaceId === space.id,
      );
      return {
        id: space.id,
        name: space.name,
        type: space.type,
        polygon: space.polygon as unknown as Point[],
        purposes: places.flatMap((poi) => [poi.name, poi.category]),
        pins: [
          ...places.map((poi) => poi.position as unknown as Point),
          ...buildingPackage.verticalConnectors.flatMap((connector) =>
            connector.stops
              .filter((stop) => stop.floorId === floorId && stop.spaceId === space.id)
              .map((stop) => stop.position as unknown as Point),
          ),
        ],
        doors: buildingPackage.portals
          .filter((portal) => portal.floorId === floorId && portal.connects.includes(space.id))
          .map((portal) => ({
            position: portal.position as unknown as Point,
            width: portal.width,
          })),
        lanes: lanes.get(space.id) ?? [],
      };
    });
}
