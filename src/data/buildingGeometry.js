/**
 * buildingGeometry.js
 * 
 * Complex, sprawling 3000x2000 architectural geometry.
 * Utilizes SVG path strings (M, L, Q, Z) for organic shapes, L-shaped rooms,
 * and massive multi-wing layouts.
 */

// Total campus footprint for background rendering
export const CAMPUS_WIDTH = 3000;
export const CAMPUS_HEIGHT = 2000;

export const BUILDING_OUTLINE = {
  // A giant cross-shape representing the walkable floor of all wings
  path: `
    M 1000,100 L 1800,100 
    L 1800,700 L 2600,700 
    L 2600,1300 L 1800,1300 
    L 1800,1900 L 1200,1900 
    L 1200,1300 L 200,1300 
    L 200,700 L 1000,700 Z
  `
};

export const ROOMS = [
  // ── West Wing (Emergency & ICU) ──
  {
    id: 'icu', category: 'medical', label: 'Intensive Care Unit', icon: '🫀', sublabel: 'Level 1 Trauma',
    // L-Shaped Path
    path: 'M 200,700 L 900,700 L 900,900 L 500,900 L 500,1300 L 200,1300 Z',
    center: { x: 350, y: 1000 }
  },
  {
    id: 'er', category: 'emergency', label: 'Emergency Room', icon: '🚨', sublabel: '24/7 Triage',
    path: 'M 500,900 L 900,900 L 900,1300 L 500,1300 Z',
    center: { x: 700, y: 1100 }
  },

  // ── North Wing (Diagnostics) ──
  {
    id: 'lab', category: 'diagnostic', label: 'Laboratory', icon: '🔬', sublabel: 'Pathology & Bloodwork',
    // L-Shaped Path
    path: 'M 1200,100 L 1800,100 L 1800,300 L 1500,300 L 1500,600 L 1200,600 Z',
    center: { x: 1350, y: 350 }
  },
  {
    id: 'radiology', category: 'diagnostic', label: 'Radiology', icon: '📡', sublabel: 'MRI, CT, X-Ray',
    path: 'M 1500,300 L 1800,300 L 1800,600 L 1500,600 Z',
    center: { x: 1650, y: 450 }
  },

  // ── East Wing (Surgery & Pediatrics) ──
  {
    id: 'surgery', category: 'medical', label: 'Surgery Center', icon: '🏥', sublabel: 'Theatres 1-8',
    // L-Shaped Path
    path: 'M 1900,700 L 2600,700 L 2600,1300 L 2300,1300 L 2300,900 L 1900,900 Z',
    center: { x: 2450, y: 1000 }
  },
  {
    id: 'pediatrics', category: 'medical', label: 'Pediatrics', icon: '👶', sublabel: 'Children\'s Wing',
    path: 'M 1900,900 L 2300,900 L 2300,1300 L 1900,1300 Z',
    center: { x: 2100, y: 1100 }
  },

  // ── South Wing (Wards & Service) ──
  {
    id: 'cafeteria', category: 'service', label: 'Cafeteria', icon: '🍽️', sublabel: 'Food & Beverage',
    path: 'M 1200,1400 L 1500,1400 L 1500,1900 L 1200,1900 Z',
    center: { x: 1350, y: 1650 }
  },
  {
    id: 'ward-a', category: 'medical', label: 'Ward A', icon: '🛏️', sublabel: 'Inpatient Rooms 100-150',
    path: 'M 1500,1400 L 1800,1400 L 1800,1700 L 1500,1700 Z',
    center: { x: 1650, y: 1550 }
  },
  {
    id: 'ward-b', category: 'medical', label: 'Ward B', icon: '🛏️', sublabel: 'Inpatient Rooms 200-250',
    path: 'M 1500,1700 L 1800,1700 L 1800,1900 L 1500,1900 Z',
    center: { x: 1650, y: 1800 }
  },

  // ── Central Atrium ──
  {
    id: 'reception', category: 'admin', label: 'Main Reception', icon: '📋', sublabel: 'Information & Registration',
    // Organic sweeping curved desk in the center of the atrium
    path: 'M 1300,1000 Q 1400,850 1500,1000 L 1460,1080 Q 1400,980 1340,1080 Z',
    center: { x: 1400, y: 1010 }
  },
  {
    id: 'pharmacy', category: 'pharmacy', label: 'Pharmacy', icon: '💊', sublabel: 'Prescription Pickup',
    path: 'M 1000,1100 L 1200,1100 L 1200,1300 L 1000,1300 Z',
    center: { x: 1100, y: 1200 }
  },
  {
    id: 'restroom-1', category: 'restroom', label: 'Restrooms', icon: '🚻', sublabel: '',
    path: 'M 1600,700 L 1800,700 L 1800,900 L 1600,900 Z',
    center: { x: 1700, y: 800 }
  }
];

export const ARCHITECTURAL_DETAILS = [
  // Elevator Banks (boxes with crosses)
  { type: 'elevator', x: 1350, y: 500, w: 100, h: 80, label: 'North Elevators' },
  { type: 'elevator', x: 1350, y: 1320, w: 100, h: 80, label: 'South Elevators' },
  
  // Thick Structural Pillars in the Atrium
  { type: 'pillar', x: 1100, y: 800, r: 25 },
  { type: 'pillar', x: 1700, y: 800, r: 25 },
  { type: 'pillar', x: 1100, y: 1200, r: 25 },
  { type: 'pillar', x: 1700, y: 1200, r: 25 },
  
  // Stairwells
  { type: 'stairs', x: 1200, y: 500, w: 80, h: 100, steps: 8 },
  { type: 'stairs', x: 1200, y: 1300, w: 80, h: 100, steps: 8 },
];

export const CORRIDOR_LABELS = [
  { text: 'NORTH WING CORRIDOR', x: 1400, y: 650, rotate: 0 },
  { text: 'SOUTH WING CORRIDOR', x: 1400, y: 1350, rotate: 0 },
  { text: 'WEST WING CORRIDOR', x: 950, y: 1000, rotate: -90 },
  { text: 'EAST WING CORRIDOR', x: 1850, y: 1000, rotate: 90 },
  { text: 'MAIN ATRIUM', x: 1400, y: 850, rotate: 0, size: 'large' },
];

// ── Entrance Marker ──
export const ENTRANCE = {
  x: 1400,
  y: 1300,
  label: 'Main Atrium Entrance',
};
