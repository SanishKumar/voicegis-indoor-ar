// @ts-check
/*
 * Writes building.json for Meridian Park Medical Campus.
 *
 * The campus is described here as rectangles on a metre grid, and the script
 * works out the rest: a doorway is placed at the middle of the wall two rooms
 * actually share, so it cannot drift off the boundary the compiler checks, and
 * the trees are planted by a seeded generator so the grounds come out the same
 * every time.
 *
 * building.json is what the compiler reads and what is reviewed; this file is
 * how it is made. After changing it:
 *
 *   node buildings/meridian-park-campus/source/author.mjs
 *   npm run compile:campus
 *   npm run venues:sync && npm run codes
 *
 * Plan coordinates: x runs east, y runs south, both in metres.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {[number, number]} Point */
/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Rect */

const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
/** @param {Rect} r @returns {Point[]} */
const polygon = (r) => [
  [r.x0, r.y0],
  [r.x1, r.y0],
  [r.x1, r.y1],
  [r.x0, r.y1],
];
/** @param {Rect} r @returns {Point} */
const centre = (r) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];

const spaces = [];
const portals = [];
const pois = [];
const anchors = [];
/** @type {Map<string, Rect>} */
const rectById = new Map();

function space(id, floorId, name, type, r, options = {}) {
  rectById.set(id, r);
  spaces.push({
    id,
    floorId,
    name,
    type,
    polygon: polygon(r),
    public: options.public ?? true,
    accessible: options.accessible ?? true,
  });
  return id;
}

/**
 * A doorway between two spaces, at the middle of the wall they share.
 * Throws if they do not share one: a typo in a coordinate fails here, loudly,
 * instead of producing a door in mid-air.
 */
function join(a, b, options = {}) {
  const ra = rectById.get(a);
  const rb = rectById.get(b);
  if (!ra || !rb) throw new Error(`join: unknown space ${!ra ? a : b}`);
  const floorId = spaces.find((entry) => entry.id === a).floorId;
  /** @type {Point | null} */
  let position = null;
  let shared = 0;
  for (const x of [ra.x0, ra.x1]) {
    if (x !== rb.x0 && x !== rb.x1) continue;
    const low = Math.max(ra.y0, rb.y0);
    const high = Math.min(ra.y1, rb.y1);
    if (high - low > shared) {
      shared = high - low;
      position = [x, (low + high) / 2];
    }
  }
  for (const y of [ra.y0, ra.y1]) {
    if (y !== rb.y0 && y !== rb.y1) continue;
    const low = Math.max(ra.x0, rb.x0);
    const high = Math.min(ra.x1, rb.x1);
    if (high - low > shared) {
      shared = high - low;
      position = [(low + high) / 2, y];
    }
  }
  if (position === null) throw new Error(`join: ${a} and ${b} share no wall`);
  const width = options.width ?? Math.min(3, shared - 0.4);
  if (width < 0.9) throw new Error(`join: ${a} and ${b} share only ${shared} m`);
  portals.push({
    id: `p-${a}--${b}`,
    floorId,
    kind: options.kind ?? 'door',
    connects: [a, b],
    position,
    width,
    accessible: options.accessible ?? true,
  });
}

function poi(id, spaceId, name, category, options = {}) {
  const home = spaces.find((entry) => entry.id === spaceId);
  if (!home) throw new Error(`poi: unknown space ${spaceId}`);
  pois.push({
    id: `poi-${id}`,
    floorId: home.floorId,
    spaceId,
    name,
    category,
    position: options.at ?? centre(rectById.get(spaceId)),
    public: options.public ?? true,
    accessible: true,
    ...(options.aliases ? { aliases: options.aliases } : {}),
  });
}

/** A printed sign. `faces` is the way the sign faces: 0 east, 90 south, 180 west, 270 north. */
function sign(id, spaceId, at, faces, slug) {
  const home = spaces.find((entry) => entry.id === spaceId);
  if (!home) throw new Error(`sign: unknown space ${spaceId}`);
  anchors.push({
    id: `anchor-${id}`,
    floorId: home.floorId,
    spaceId,
    kind: 'qr',
    position: at,
    headingDegrees: faces,
    payload: `voicegis://meridian/${home.floorId}/${slug}`,
  });
}

// --------------------------------------------------------------- the site
const SITE = rect(0, 0, 210, 150);
const HOSPITAL = rect(40, 8, 150, 46);
const EMERGENCY = rect(8, 62, 50, 106);
const PAVILION = rect(160, 62, 202, 106);

// ------------------------------------------------- outside: where you walk
space('gate', 'g', 'Main Gate', 'entrance', rect(99, 134, 111, 142));
space('promenade', 'g', 'Garden Promenade', 'corridor', rect(102, 96, 108, 134));
// The court is a ring of four walks round the fountain, so a route goes round
// the water instead of through it.
space('court-north', 'g', 'Fountain Court', 'corridor', rect(93, 72, 117, 78));
space('court-south', 'g', 'Fountain Court', 'corridor', rect(93, 90, 117, 96));
space('court-west', 'g', 'Fountain Court', 'corridor', rect(93, 78, 99, 90));
space('court-east', 'g', 'Fountain Court', 'corridor', rect(111, 78, 117, 90));
space('forecourt', 'g', 'Hospital Forecourt', 'corridor', rect(102, 46, 108, 72));
space('west-walk', 'g', 'West Garden Walk', 'corridor', rect(50, 81, 93, 87));
space('east-walk', 'g', 'East Garden Walk', 'corridor', rect(117, 81, 160, 87));
space('car-park', 'g', 'Visitor Car Park', 'lobby', rect(24, 112, 96, 134));
space('car-park-walk', 'g', 'Car Park Walk', 'corridor', rect(96, 120, 102, 126));
space('garden-path', 'g', 'Garden Path', 'corridor', rect(108, 110, 126, 116));
space('healing-garden', 'g', 'Healing Garden', 'lobby', rect(126, 100, 156, 126));

join('gate', 'promenade', { kind: 'gate', width: 4 });
join('promenade', 'court-south', { kind: 'opening', width: 4 });
join('court-south', 'court-west', { kind: 'opening', width: 4 });
join('court-south', 'court-east', { kind: 'opening', width: 4 });
join('court-north', 'court-west', { kind: 'opening', width: 4 });
join('court-north', 'court-east', { kind: 'opening', width: 4 });
join('court-north', 'forecourt', { kind: 'opening', width: 4 });
join('court-west', 'west-walk', { kind: 'opening', width: 4 });
join('court-east', 'east-walk', { kind: 'opening', width: 4 });
join('promenade', 'car-park-walk', { kind: 'opening', width: 4 });
join('car-park-walk', 'car-park', { kind: 'opening', width: 4 });
join('promenade', 'garden-path', { kind: 'opening', width: 4 });
join('garden-path', 'healing-garden', { kind: 'opening', width: 4 });

poi('main-gate', 'gate', 'Main Gate', 'entrance', { aliases: ['front gate', 'entrance'] });
poi('fountain', 'court-north', 'Central Fountain', 'landmark', {
  at: [105, 76],
  aliases: ['fountain', 'fountain court'],
});
// In the middle of it. A place is reached through the middle of its space, so
// one pinned by the way out sent everybody leaving the car park 24 m into it
// and back again.
poi('car-park', 'car-park', 'Visitor Car Park', 'service', {
  at: [60, 123],
  aliases: ['parking', 'car park'],
});
poi('statue', 'healing-garden', "Founders' Statue", 'landmark', {
  at: [146, 108],
  aliases: ['statue', 'memorial'],
});
poi('healing-garden', 'healing-garden', 'Healing Garden', 'landmark', {
  at: [136, 118],
  aliases: ['garden'],
});

// ------------------------------------------------ the main hospital, ground
space('g-hall', 'g', 'Main Entrance Hall', 'lobby', rect(96, 32, 114, 46));
space('g-concourse', 'g', 'Main Concourse', 'corridor', rect(44, 24, 146, 32));
join('forecourt', 'g-hall', { width: 4 });
join('g-hall', 'g-concourse', { kind: 'opening', width: 6 });

const groundNorth = [
  [
    'g-registration',
    'Outpatient Registration',
    'room',
    44,
    60,
    'service',
    ['registration', 'check in'],
  ],
  ['g-pharmacy', 'Hospital Pharmacy', 'room', 60, 74, 'pharmacy', ['chemist', 'prescriptions']],
  ['g-imaging', 'Imaging & Radiology', 'room', 74, 92, 'diagnostic', ['x-ray', 'mri', 'scan']],
  ['g-lifts', 'Main Lift Lobby', 'vertical-circulation', 92, 100, null, null],
  ['g-stairs', 'Main Stair Hall', 'vertical-circulation', 100, 106, null, null],
  ['g-laboratory', 'Laboratory', 'room', 106, 122, 'diagnostic', ['lab', 'pathology']],
  ['g-cardiology', 'Cardiology Clinic', 'room', 122, 146, 'medical', ['heart clinic']],
];
const groundSouth = [
  [
    'g-information',
    'Visitor Information',
    'service',
    44,
    62,
    'service',
    ['help desk', 'reception'],
  ],
  ['g-cafe', 'Courtyard Café', 'room', 62, 80, 'food', ['coffee', 'cafe']],
  ['g-shop', 'Gift & Flower Shop', 'room', 80, 96, 'service', ['shop', 'flowers']],
  ['g-quiet-room', 'Quiet Room', 'room', 114, 128, 'family', ['chapel', 'prayer room']],
  ['g-blood-tests', 'Blood Tests', 'room', 128, 146, 'diagnostic', ['phlebotomy']],
];

function row(floorId, concourse, rooms, y0, y1) {
  for (const [id, name, type, x0, x1, category, aliases, options] of rooms) {
    space(id, floorId, name, type, rect(x0, y0, x1, y1), options ?? {});
    join(id, concourse, type === 'vertical-circulation' ? { kind: 'opening' } : {});
    if (category) poi(id, id, name, category, { aliases, public: options?.public });
  }
}
row('g', 'g-concourse', groundNorth, 10, 24);
row('g', 'g-concourse', groundSouth, 32, 44);
// In the middle of the hall, as every place is in the middle of its space
// unless there is a reason. Pinned just inside the door, it was passed on the
// way in to the middle and then walked back to.
poi('main-entrance', 'g-hall', 'Hospital Main Entrance', 'entrance', {
  aliases: ['hospital entrance', 'main hospital'],
});

// -------------------------------------------------- the main hospital, above
space('l1-concourse', 'l1', 'Level 1 Concourse', 'corridor', rect(44, 24, 146, 32));
row(
  'l1',
  'l1-concourse',
  [
    ['l1-maternity', 'Maternity Unit', 'room', 44, 66, 'family', ['birth', 'labour ward']],
    ['l1-childrens', "Children's Ward", 'room', 66, 92, 'family', ['paediatrics', 'kids']],
    ['l1-lifts', 'Level 1 Lift Lobby', 'vertical-circulation', 92, 100, null, null],
    ['l1-stairs', 'Level 1 Stair Hall', 'vertical-circulation', 100, 106, null, null],
    ['l1-day-surgery', 'Day Surgery', 'room', 106, 126, 'medical', ['surgery']],
    ['l1-recovery', 'Recovery Suite', 'room', 126, 146, 'medical', ['recovery']],
  ],
  10,
  24,
);
row(
  'l1',
  'l1-concourse',
  [
    ['l1-womens-health', "Women's Health Clinic", 'room', 44, 70, 'medical', ['gynaecology']],
    ['l1-ultrasound', 'Ultrasound', 'room', 70, 96, 'diagnostic', ['scan']],
    ['l1-family-lounge', 'Family Lounge', 'lobby', 96, 114, 'family', ['waiting area']],
    ['l1-physiotherapy', 'Outpatient Physiotherapy', 'room', 114, 146, 'medical', ['physio']],
  ],
  32,
  44,
);

space('l2-concourse', 'l2', 'Level 2 Concourse', 'corridor', rect(44, 24, 146, 32));
row(
  'l2',
  'l2-concourse',
  [
    ['l2-cardiac-ward', 'Cardiac Ward', 'room', 44, 70, 'medical', ['heart ward']],
    [
      'l2-oncology',
      'Oncology Day Unit',
      'room',
      70,
      92,
      'medical',
      ['cancer care', 'chemotherapy'],
    ],
    ['l2-lifts', 'Level 2 Lift Lobby', 'vertical-circulation', 92, 100, null, null],
    ['l2-stairs', 'Level 2 Stair Hall', 'vertical-circulation', 100, 106, null, null],
    ['l2-dialysis', 'Dialysis Unit', 'room', 106, 126, 'medical', ['renal', 'kidney']],
    ['l2-research', 'Clinical Research Office', 'room', 126, 146, 'research', ['trials']],
  ],
  10,
  24,
);
row(
  'l2',
  'l2-concourse',
  [
    ['l2-administration', 'Administration', 'service', 44, 70, 'service', ['admin', 'records']],
    ['l2-education', 'Education Centre', 'room', 70, 96, 'education', ['lecture room', 'training']],
    [
      'l2-staff-lounge',
      'Staff Lounge',
      'restricted',
      96,
      114,
      'staff',
      ['staff room'],
      { public: false },
    ],
    ['l2-sky-terrace', 'Sky Terrace', 'lobby', 114, 146, 'landmark', ['terrace', 'roof garden']],
  ],
  32,
  44,
);

// ------------------------------------------- the emergency centre, to the west
space('e-entrance', 'g', 'Emergency Entrance', 'lobby', rect(40, 78, 50, 90));
space('e-corridor', 'g', 'Emergency Corridor', 'corridor', rect(34, 66, 40, 102));
join('west-walk', 'e-entrance', { width: 4 });
join('e-entrance', 'e-corridor', { kind: 'opening', width: 5 });
for (const [id, name, x0, y0, x1, y1, category, aliases] of [
  ['e-triage', 'Triage', 12, 66, 34, 78, 'emergency', ['assessment']],
  ['e-treatment', 'Emergency Treatment', 12, 78, 34, 90, 'emergency', ['a&e', 'er', 'casualty']],
  ['e-minor-injuries', 'Minor Injuries', 12, 90, 34, 102, 'emergency', ['urgent care']],
  ['e-waiting', 'Emergency Waiting Area', 40, 66, 48, 78, 'family', ['waiting room']],
  ['e-pharmacy', 'Out-of-Hours Pharmacy', 40, 90, 48, 102, 'pharmacy', ['night pharmacy']],
]) {
  space(id, 'g', name, 'room', rect(x0, y0, x1, y1));
  join(id, 'e-corridor');
  poi(id, id, name, category, { aliases });
}
poi('emergency-entrance', 'e-entrance', 'Emergency Entrance', 'emergency', {
  aliases: ['emergency', 'a&e entrance'],
});

// --------------------------------------- the wellness pavilion, to the east
space('w-entrance', 'g', 'Pavilion Entrance', 'lobby', rect(160, 78, 170, 90));
space('w-gallery', 'g', 'Pavilion Gallery', 'corridor', rect(170, 66, 176, 102));
join('east-walk', 'w-entrance', { width: 4 });
join('w-entrance', 'w-gallery', { kind: 'opening', width: 5 });
for (const [id, name, x0, y0, x1, y1, category, aliases] of [
  ['w-hydrotherapy', 'Hydrotherapy Pool', 176, 66, 198, 80, 'medical', ['pool']],
  ['w-gym', 'Rehabilitation Gym', 176, 80, 198, 92, 'medical', ['physio gym', 'rehab']],
  ['w-studio', 'Wellness Studio', 176, 92, 198, 102, 'family', ['yoga', 'classes']],
  ['w-reception', 'Pavilion Reception', 162, 66, 170, 78, 'service', ['rehab reception']],
  ['w-therapy', 'Therapy Rooms', 162, 90, 170, 102, 'medical', ['occupational therapy']],
]) {
  space(id, 'g', name, 'room', rect(x0, y0, x1, y1));
  join(id, 'w-gallery');
  poi(id, id, name, category, { aliases });
}
poi('pavilion-entrance', 'w-entrance', 'Wellness Pavilion Entrance', 'entrance', {
  aliases: ['pavilion', 'rehabilitation'],
});

// ----------------------------------------------------- lifts, stairs, signs
const verticalConnectors = [
  {
    id: 'lift-main',
    name: 'Main Lifts',
    kind: 'elevator',
    accessible: true,
    stops: ['g', 'l1', 'l2'].map((floorId) => ({
      floorId,
      spaceId: `${floorId}-lifts`,
      position: [96, 15],
    })),
  },
  {
    id: 'stairs-main',
    name: 'Main Stairs',
    kind: 'stairs',
    accessible: false,
    stops: ['g', 'l1', 'l2'].map((floorId) => ({
      floorId,
      spaceId: `${floorId}-stairs`,
      position: [103, 15],
    })),
  },
];

sign('main-gate', 'gate', [105, 141], 270, 'main-gate');
sign('fountain', 'court-north', [105, 77], 270, 'fountain');
sign('hospital-entrance', 'g-hall', [105, 34], 90, 'hospital-entrance');
sign('emergency-entrance', 'e-entrance', [42, 84], 0, 'emergency-entrance');
sign('pavilion-entrance', 'w-entrance', [168, 84], 180, 'pavilion-entrance');
sign('car-park', 'car-park', [94, 123], 180, 'car-park');
sign('level-1', 'l1-concourse', [96, 26], 90, 'lifts');
sign('level-2', 'l2-concourse', [96, 26], 90, 'lifts');

// --------------------------------------------- the grounds: drawn, not walked
const grounds = [
  ['road-south', 'road', rect(0, 142, 210, 150)],
  ['car-park-bays', 'parking', rect(24, 112, 96, 134)],
  ['lawn-north-west', 'lawn', rect(52, 50, 100, 70)],
  ['lawn-north-east', 'lawn', rect(110, 50, 158, 70)],
  ['lawn-west', 'lawn', rect(52, 89, 91, 108)],
  ['lawn-east', 'lawn', rect(119, 89, 158, 98)],
  ['lawn-south-east', 'lawn', rect(160, 110, 204, 140)],
  ['lawn-north', 'lawn', rect(4, 4, 36, 58)],
  ['lawn-far-east', 'lawn', rect(154, 4, 206, 58)],
  ['healing-garden-lawn', 'lawn', rect(126, 100, 156, 126)],
  ['pond', 'water', rect(170, 116, 196, 134)],
  ['fountain-island', 'planting', rect(99, 78, 111, 90)],
  ['forecourt-apron', 'paving', rect(84, 46, 126, 50)],
  ['border-south-west', 'planting', rect(4, 136, 97, 140)],
  ['border-south-east', 'planting', rect(113, 136, 158, 140)],
].map(([id, kind, r]) => ({ id, kind, polygon: polygon(r) }));

// Seeded, so the same trees stand in the same places every time.
let seed = 20261002;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const features = [];
const walked = [...rectById.values()];
const clear = ([x, y], margin) =>
  walked.every(
    (r) => x < r.x0 - margin || x > r.x1 + margin || y < r.y0 - margin || y > r.y1 + margin,
  );
let treeCount = 0;
function tree(at) {
  if (!clear(at, 1.6)) return;
  if (grounds.some((g) => g.kind === 'water' && inside(at, g.polygon, 1.5))) return;
  treeCount += 1;
  features.push({ id: `tree-${String(treeCount).padStart(3, '0')}`, kind: 'tree', position: at });
}
function inside([x, y], poly, margin = 0) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return (
    x > Math.min(...xs) - margin &&
    x < Math.max(...xs) + margin &&
    y > Math.min(...ys) - margin &&
    y < Math.max(...ys) + margin
  );
}
// Loose groves on the lawns.
for (const ground of grounds.filter((g) => g.kind === 'lawn')) {
  const xs = ground.polygon.map((p) => p[0]);
  const ys = ground.polygon.map((p) => p[1]);
  for (let x = Math.min(...xs) + 4; x < Math.max(...xs) - 3; x += 8) {
    for (let y = Math.min(...ys) + 4; y < Math.max(...ys) - 3; y += 8) {
      if (random() < 0.3) continue;
      tree([
        Number((x + (random() - 0.5) * 4).toFixed(1)),
        Number((y + (random() - 0.5) * 4).toFixed(1)),
      ]);
    }
  }
}
// An avenue down each side of the promenade.
for (let y = 99; y <= 132; y += 6) {
  tree([99.5, y]);
  tree([110.5, y]);
}
features.push({ id: 'fountain-central', kind: 'fountain', position: [105, 84] });
features.push({ id: 'statue-founders', kind: 'statue', position: [148, 106] });
for (const [index, at] of [
  [132, 104],
  [150, 120],
  [130, 122],
  [100.5, 70],
  [109.5, 70],
].entries()) {
  features.push({ id: `bench-${index + 1}`, kind: 'bench', position: at });
}
for (const [index, y] of [100, 112, 124, 132].entries()) {
  features.push({ id: `lamp-west-${index + 1}`, kind: 'lamp', position: [101, y] });
  features.push({ id: `lamp-east-${index + 1}`, kind: 'lamp', position: [109, y] });
}

const source = {
  schemaVersion: '0.1.0',
  building: {
    id: 'meridian-park-campus',
    name: 'Meridian Park Medical Campus',
    units: 'meters',
    entrySpaceId: 'gate',
    coordinateSystem: { type: 'local-cartesian', origin: [0, 0, 0], northOffsetDegrees: 0 },
  },
  floors: [
    {
      id: 'g',
      name: 'Ground · Campus',
      level: 0,
      elevation: 0,
      clearHeight: 4.2,
      outline: polygon(SITE),
    },
    {
      id: 'l1',
      name: 'Level 1 · Women & Children',
      level: 1,
      elevation: 4.8,
      clearHeight: 3.7,
      outline: polygon(HOSPITAL),
    },
    {
      id: 'l2',
      name: 'Level 2 · Wards & Research',
      level: 2,
      elevation: 9,
      clearHeight: 3.7,
      outline: polygon(HOSPITAL),
    },
  ],
  spaces,
  portals,
  verticalConnectors,
  pois,
  localizationAnchors: anchors,
  site: {
    floorId: 'g',
    buildings: [
      { id: 'main-hospital', name: 'Main Hospital', footprint: polygon(HOSPITAL), storeys: 3 },
      {
        id: 'emergency-centre',
        name: 'Emergency Centre',
        footprint: polygon(EMERGENCY),
        storeys: 1,
      },
      {
        id: 'wellness-pavilion',
        name: 'Wellness Pavilion',
        footprint: polygon(PAVILION),
        storeys: 1,
      },
    ],
    grounds,
    features,
  },
};

const output = path.join(here, 'building.json');
writeFileSync(output, `${JSON.stringify(source, null, 2)}\n`);
console.log(
  `${path.relative(process.cwd(), output)}: ${spaces.length} spaces, ${portals.length} portals, ` +
    `${pois.length} places, ${anchors.length} signs, ${grounds.length} grounds, ${features.length} features`,
);
