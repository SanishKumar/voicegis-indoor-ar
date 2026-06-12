/**
 * buildingGeometry.js
 * 
 * Extreme High-Density Mall/Hospital Layout.
 * Dozens of tightly packed rooms with thick distinct walls to match the 
 * professional blueprint complexity requested.
 */

export const CAMPUS_WIDTH = 2000;
export const CAMPUS_HEIGHT = 1500;

// The main background floor is the entire walkable rectangle.
// Rooms will be drawn on top of this floor, leaving the corridors as negative space.
export const BUILDING_OUTLINE = {
  path: `M 100,100 L 1900,100 L 1900,1300 L 100,1300 Z`
};

// Helper to easily define rectangular rooms
const makeRoom = (id, category, label, icon, x, y, w, h) => ({
  id, category, label, icon,
  path: `M ${x},${y} L ${x+w},${y} L ${x+w},${y+h} L ${x},${y+h} Z`,
  center: { x: x + w/2, y: y + h/2 },
  bounds: { x, y, w, h }
});

export const ROOMS = [
  // ── TOP ROW (Y: 100 to 300) ──
  makeRoom('ward-1', 'medical', 'Ward 1', '🛏️', 100, 100, 300, 200),
  makeRoom('ward-2', 'medical', 'Ward 2', '🛏️', 400, 100, 300, 200),
  makeRoom('ward-3', 'medical', 'Ward 3', '🛏️', 700, 100, 300, 200),
  makeRoom('ward-4', 'medical', 'Ward 4', '🛏️', 1000, 100, 300, 200),
  makeRoom('pharmacy', 'pharmacy', 'Pharmacy', '💊', 1300, 100, 300, 200),
  makeRoom('gift-shop', 'service', 'Gift Shop', '🛍️', 1600, 100, 300, 200),

  // ── LEFT WING (X: 100 to 300, Y: 400 to 1000) ──
  makeRoom('storage', 'admin', 'Storage', '📦', 100, 400, 200, 150),
  makeRoom('office-1', 'admin', 'Office A', '💻', 100, 550, 200, 150),
  makeRoom('office-2', 'admin', 'Office B', '💻', 100, 700, 200, 150),
  makeRoom('restroom-w', 'restroom', 'Restroom', '🚻', 100, 850, 200, 150),

  // ── RIGHT WING (X: 1700 to 1900, Y: 400 to 1000) ──
  makeRoom('er-triage', 'emergency', 'ER Triage', '📋', 1700, 400, 200, 150),
  makeRoom('er-bay-1', 'emergency', 'ER Bay 1', '🚨', 1700, 550, 200, 150),
  makeRoom('er-bay-2', 'emergency', 'ER Bay 2', '🚨', 1700, 700, 200, 150),
  makeRoom('er-bay-3', 'emergency', 'ER Bay 3', '🚨', 1700, 850, 200, 150),

  // ── BOTTOM ROW (Y: 1100 to 1300) ──
  makeRoom('cafeteria', 'service', 'Cafeteria', '🍽️', 100, 1100, 300, 200),
  makeRoom('kitchen', 'service', 'Kitchen', '🍳', 400, 1100, 300, 200),
  makeRoom('admin-main', 'admin', 'Admin', '📁', 700, 1100, 300, 200),
  makeRoom('security', 'admin', 'Security', '🛡️', 1000, 1100, 300, 200),
  makeRoom('reception', 'admin', 'Reception', '💁', 1300, 1100, 300, 200),
  makeRoom('lobby', 'entrance', 'Main Lobby', '🛋️', 1600, 1100, 300, 200),

  // ── CENTRAL ISLAND LEFT (X: 400 to 900, Y: 400 to 1000) ──
  makeRoom('surgery', 'medical', 'Surgery Center', '🏥', 400, 400, 500, 300),
  makeRoom('icu', 'medical', 'Intensive Care Unit', '🫀', 400, 700, 500, 300),

  // ── CENTRAL ISLAND RIGHT (X: 1100 to 1600, Y: 400 to 1000) ──
  makeRoom('pediatrics', 'medical', 'Pediatrics', '👶', 1100, 400, 500, 200),
  makeRoom('radiology', 'diagnostic', 'Radiology', '📡', 1100, 600, 500, 200),
  makeRoom('lab', 'diagnostic', 'Laboratory', '🔬', 1100, 800, 500, 200),
];

// No floating external details, everything is tightly bound inside the rooms to look
// like a real densely packed blueprint.
export const ARCHITECTURAL_DETAILS = [];

// Labels placed perfectly in the negative space (the corridors)
export const CORRIDOR_LABELS = [
  { text: 'NORTH CORRIDOR', x: 1000, y: 350, rotate: 0 },
  { text: 'SOUTH CORRIDOR', x: 1000, y: 1050, rotate: 0 },
  { text: 'WEST CORRIDOR', x: 350, y: 700, rotate: -90 },
  { text: 'EAST CORRIDOR', x: 1650, y: 700, rotate: 90 },
  { text: 'CENTRAL ATRIUM', x: 1000, y: 700, rotate: 90 },
];

export const ENTRANCE = { x: 1750, y: 1250, label: 'South East Entrance' };
