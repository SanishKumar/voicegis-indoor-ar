/**
 * buildingGraph.js
 * 
 * High-Precision Orthogonal Graph.
 * All route segments are mathematically snapped to the exact center of the corridors
 * to guarantee that path lines NEVER clip through the dense walls.
 */

export const CATEGORIES = {
  emergency:  { id: 'emergency',  label: 'Emergency',   color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)',  icon: '🚨' },
  medical:    { id: 'medical',    label: 'Medical',      color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.15)', icon: '🏥' },
  diagnostic: { id: 'diagnostic', label: 'Diagnostic',   color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.15)', icon: '🔬' },
  pharmacy:   { id: 'pharmacy',   label: 'Pharmacy',     color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.15)', icon: '💊' },
  service:    { id: 'service',    label: 'Services',     color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.15)', icon: '🍽️' },
  admin:      { id: 'admin',      label: 'Admin',        color: '#6b7394', bgColor: 'rgba(107, 115, 148, 0.15)', icon: '📋' },
  entrance:   { id: 'entrance',   label: 'Entrance',     color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.15)',  icon: '🚪' },
  restroom:   { id: 'restroom',   label: 'Restroom',     color: '#64748b', bgColor: 'rgba(100, 116, 139, 0.15)', icon: '🚻' },
};

export const NODES = [
  // ── ROOM CENTERS (POIs) ──
  // Top Row
  { id: 'ward-1', x: 250, y: 200, floor: 1, type: 'poi', poi: { name: 'Ward 1', category: 'medical', icon: '🛏️', description: 'Inpatient' } },
  { id: 'ward-2', x: 550, y: 200, floor: 1, type: 'poi', poi: { name: 'Ward 2', category: 'medical', icon: '🛏️', description: 'Inpatient' } },
  { id: 'ward-3', x: 850, y: 200, floor: 1, type: 'poi', poi: { name: 'Ward 3', category: 'medical', icon: '🛏️', description: 'Inpatient' } },
  { id: 'ward-4', x: 1150, y: 200, floor: 1, type: 'poi', poi: { name: 'Ward 4', category: 'medical', icon: '🛏️', description: 'Inpatient' } },
  { id: 'pharmacy', x: 1450, y: 200, floor: 1, type: 'poi', poi: { name: 'Pharmacy', category: 'pharmacy', icon: '💊', description: 'Prescriptions' } },
  { id: 'gift-shop', x: 1750, y: 200, floor: 1, type: 'poi', poi: { name: 'Gift Shop', category: 'service', icon: '🛍️', description: 'Retail' } },
  
  // Left Wing
  { id: 'storage', x: 200, y: 475, floor: 1, type: 'poi', poi: { name: 'Storage', category: 'admin', icon: '📦', description: 'Supply' } },
  { id: 'office-1', x: 200, y: 625, floor: 1, type: 'poi', poi: { name: 'Office A', category: 'admin', icon: '💻', description: 'Administration' } },
  { id: 'office-2', x: 200, y: 775, floor: 1, type: 'poi', poi: { name: 'Office B', category: 'admin', icon: '💻', description: 'Administration' } },
  { id: 'restroom-w', x: 200, y: 925, floor: 1, type: 'poi', poi: { name: 'Restroom', category: 'restroom', icon: '🚻', description: 'Public' } },

  // Right Wing
  { id: 'er-triage', x: 1800, y: 475, floor: 1, type: 'poi', poi: { name: 'ER Triage', category: 'emergency', icon: '📋', description: 'Emergency Intake' } },
  { id: 'er-bay-1', x: 1800, y: 625, floor: 1, type: 'poi', poi: { name: 'ER Bay 1', category: 'emergency', icon: '🚨', description: 'Trauma' } },
  { id: 'er-bay-2', x: 1800, y: 775, floor: 1, type: 'poi', poi: { name: 'ER Bay 2', category: 'emergency', icon: '🚨', description: 'Trauma' } },
  { id: 'er-bay-3', x: 1800, y: 925, floor: 1, type: 'poi', poi: { name: 'ER Bay 3', category: 'emergency', icon: '🚨', description: 'Trauma' } },

  // Bottom Row
  { id: 'cafeteria', x: 250, y: 1200, floor: 1, type: 'poi', poi: { name: 'Cafeteria', category: 'service', icon: '🍽️', description: 'Dining' } },
  { id: 'kitchen', x: 550, y: 1200, floor: 1, type: 'poi', poi: { name: 'Kitchen', category: 'service', icon: '🍳', description: 'Staff Only' } },
  { id: 'admin-main', x: 850, y: 1200, floor: 1, type: 'poi', poi: { name: 'Admin', category: 'admin', icon: '📁', description: 'Head Office' } },
  { id: 'security', x: 1150, y: 1200, floor: 1, type: 'poi', poi: { name: 'Security', category: 'admin', icon: '🛡️', description: 'Security Office' } },
  { id: 'reception', x: 1450, y: 1200, floor: 1, type: 'poi', poi: { name: 'Reception', category: 'admin', icon: '💁', description: 'Information' } },
  { id: 'lobby', x: 1750, y: 1200, floor: 1, type: 'poi', poi: { name: 'Main Lobby', category: 'entrance', icon: '🛋️', description: 'Waiting Area' } },

  // Islands
  { id: 'surgery', x: 650, y: 550, floor: 1, type: 'poi', poi: { name: 'Surgery Center', category: 'medical', icon: '🏥', description: 'Operating Theaters' } },
  { id: 'icu', x: 650, y: 850, floor: 1, type: 'poi', poi: { name: 'ICU', category: 'medical', icon: '🫀', description: 'Intensive Care' } },
  { id: 'pediatrics', x: 1350, y: 500, floor: 1, type: 'poi', poi: { name: 'Pediatrics', category: 'medical', icon: '👶', description: 'Children' } },
  { id: 'radiology', x: 1350, y: 700, floor: 1, type: 'poi', poi: { name: 'Radiology', category: 'diagnostic', icon: '📡', description: 'Imaging' } },
  { id: 'lab', x: 1350, y: 900, floor: 1, type: 'poi', poi: { name: 'Laboratory', category: 'diagnostic', icon: '🔬', description: 'Testing' } },

  // ── CORRIDOR JUNCTIONS (Orthogonal grid) ──
  // North Corridor (y=350)
  { id: 'jn_250', x: 250, y: 350, floor: 1, type: 'junction' },
  { id: 'jn_350', x: 350, y: 350, floor: 1, type: 'junction' }, // NW Corner
  { id: 'jn_550', x: 550, y: 350, floor: 1, type: 'junction' },
  { id: 'jn_850', x: 850, y: 350, floor: 1, type: 'junction' },
  { id: 'jn_1000', x: 1000, y: 350, floor: 1, type: 'junction' }, // Top of Central Corridor
  { id: 'jn_1150', x: 1150, y: 350, floor: 1, type: 'junction' },
  { id: 'jn_1450', x: 1450, y: 350, floor: 1, type: 'junction' },
  { id: 'jn_1650', x: 1650, y: 350, floor: 1, type: 'junction' }, // NE Corner
  { id: 'jn_1750', x: 1750, y: 350, floor: 1, type: 'junction' },

  // South Corridor (y=1050)
  { id: 'js_250', x: 250, y: 1050, floor: 1, type: 'junction' },
  { id: 'js_350', x: 350, y: 1050, floor: 1, type: 'junction' }, // SW Corner
  { id: 'js_550', x: 550, y: 1050, floor: 1, type: 'junction' },
  { id: 'js_850', x: 850, y: 1050, floor: 1, type: 'junction' },
  { id: 'js_1000', x: 1000, y: 1050, floor: 1, type: 'junction' }, // Bottom of Central Corridor
  { id: 'js_1150', x: 1150, y: 1050, floor: 1, type: 'junction' },
  { id: 'js_1450', x: 1450, y: 1050, floor: 1, type: 'junction' },
  { id: 'js_1650', x: 1650, y: 1050, floor: 1, type: 'junction' }, // SE Corner
  { id: 'js_1750', x: 1750, y: 1050, floor: 1, type: 'junction' },

  // West Corridor Spine (x=350)
  { id: 'jw_475', x: 350, y: 475, floor: 1, type: 'junction' },
  { id: 'jw_550', x: 350, y: 550, floor: 1, type: 'junction' },
  { id: 'jw_625', x: 350, y: 625, floor: 1, type: 'junction' },
  { id: 'jw_775', x: 350, y: 775, floor: 1, type: 'junction' },
  { id: 'jw_850', x: 350, y: 850, floor: 1, type: 'junction' },
  { id: 'jw_925', x: 350, y: 925, floor: 1, type: 'junction' },

  // Central Corridor Spine (x=1000)
  { id: 'jc_500', x: 1000, y: 500, floor: 1, type: 'junction' },
  { id: 'jc_700', x: 1000, y: 700, floor: 1, type: 'junction' },
  { id: 'jc_900', x: 1000, y: 900, floor: 1, type: 'junction' },

  // East Corridor Spine (x=1650)
  { id: 'je_475', x: 1650, y: 475, floor: 1, type: 'junction' },
  { id: 'je_625', x: 1650, y: 625, floor: 1, type: 'junction' },
  { id: 'je_775', x: 1650, y: 775, floor: 1, type: 'junction' },
  { id: 'je_925', x: 1650, y: 925, floor: 1, type: 'junction' },
];

export const EDGES = [
  // ── ROOM TO CORRIDOR DOORS ──
  { from: 'ward-1', to: 'jn_250', distance: 15, corridor: 'North Corridor' },
  { from: 'ward-2', to: 'jn_550', distance: 15, corridor: 'North Corridor' },
  { from: 'ward-3', to: 'jn_850', distance: 15, corridor: 'North Corridor' },
  { from: 'ward-4', to: 'jn_1150', distance: 15, corridor: 'North Corridor' },
  { from: 'pharmacy', to: 'jn_1450', distance: 15, corridor: 'North Corridor' },
  { from: 'gift-shop', to: 'jn_1750', distance: 15, corridor: 'North Corridor' },

  { from: 'storage', to: 'jw_475', distance: 15, corridor: 'West Corridor' },
  { from: 'office-1', to: 'jw_625', distance: 15, corridor: 'West Corridor' },
  { from: 'office-2', to: 'jw_775', distance: 15, corridor: 'West Corridor' },
  { from: 'restroom-w', to: 'jw_925', distance: 15, corridor: 'West Corridor' },

  { from: 'er-triage', to: 'je_475', distance: 15, corridor: 'East Corridor' },
  { from: 'er-bay-1', to: 'je_625', distance: 15, corridor: 'East Corridor' },
  { from: 'er-bay-2', to: 'je_775', distance: 15, corridor: 'East Corridor' },
  { from: 'er-bay-3', to: 'je_925', distance: 15, corridor: 'East Corridor' },

  { from: 'cafeteria', to: 'js_250', distance: 15, corridor: 'South Corridor' },
  { from: 'kitchen', to: 'js_550', distance: 15, corridor: 'South Corridor' },
  { from: 'admin-main', to: 'js_850', distance: 15, corridor: 'South Corridor' },
  { from: 'security', to: 'js_1150', distance: 15, corridor: 'South Corridor' },
  { from: 'reception', to: 'js_1450', distance: 15, corridor: 'South Corridor' },
  { from: 'lobby', to: 'js_1750', distance: 15, corridor: 'South Corridor' },

  { from: 'surgery', to: 'jw_550', distance: 30, corridor: 'West Corridor' },
  { from: 'icu', to: 'jw_850', distance: 30, corridor: 'West Corridor' },

  { from: 'pediatrics', to: 'jc_500', distance: 30, corridor: 'Central Atrium' },
  { from: 'radiology', to: 'jc_700', distance: 30, corridor: 'Central Atrium' },
  { from: 'lab', to: 'jc_900', distance: 30, corridor: 'Central Atrium' },

  // ── CORRIDOR SEGMENTS ──
  // North Corridor (West to East)
  { from: 'jn_250', to: 'jn_350', distance: 10, corridor: 'North Corridor' },
  { from: 'jn_350', to: 'jn_550', distance: 20, corridor: 'North Corridor' },
  { from: 'jn_550', to: 'jn_850', distance: 30, corridor: 'North Corridor' },
  { from: 'jn_850', to: 'jn_1000', distance: 15, corridor: 'North Corridor' },
  { from: 'jn_1000', to: 'jn_1150', distance: 15, corridor: 'North Corridor' },
  { from: 'jn_1150', to: 'jn_1450', distance: 30, corridor: 'North Corridor' },
  { from: 'jn_1450', to: 'jn_1650', distance: 20, corridor: 'North Corridor' },
  { from: 'jn_1650', to: 'jn_1750', distance: 10, corridor: 'North Corridor' },

  // South Corridor (West to East)
  { from: 'js_250', to: 'js_350', distance: 10, corridor: 'South Corridor' },
  { from: 'js_350', to: 'js_550', distance: 20, corridor: 'South Corridor' },
  { from: 'js_550', to: 'js_850', distance: 30, corridor: 'South Corridor' },
  { from: 'js_850', to: 'js_1000', distance: 15, corridor: 'South Corridor' },
  { from: 'js_1000', to: 'js_1150', distance: 15, corridor: 'South Corridor' },
  { from: 'js_1150', to: 'js_1450', distance: 30, corridor: 'South Corridor' },
  { from: 'js_1450', to: 'js_1650', distance: 20, corridor: 'South Corridor' },
  { from: 'js_1650', to: 'js_1750', distance: 10, corridor: 'South Corridor' },

  // West Corridor (North to South)
  { from: 'jn_350', to: 'jw_475', distance: 12, corridor: 'West Corridor' },
  { from: 'jw_475', to: 'jw_550', distance: 7, corridor: 'West Corridor' },
  { from: 'jw_550', to: 'jw_625', distance: 7, corridor: 'West Corridor' },
  { from: 'jw_625', to: 'jw_775', distance: 15, corridor: 'West Corridor' },
  { from: 'jw_775', to: 'jw_850', distance: 7, corridor: 'West Corridor' },
  { from: 'jw_850', to: 'jw_925', distance: 7, corridor: 'West Corridor' },
  { from: 'jw_925', to: 'js_350', distance: 12, corridor: 'West Corridor' },

  // Central Corridor (North to South)
  { from: 'jn_1000', to: 'jc_500', distance: 15, corridor: 'Central Atrium' },
  { from: 'jc_500', to: 'jc_700', distance: 20, corridor: 'Central Atrium' },
  { from: 'jc_700', to: 'jc_900', distance: 20, corridor: 'Central Atrium' },
  { from: 'jc_900', to: 'js_1000', distance: 15, corridor: 'Central Atrium' },

  // East Corridor (North to South)
  { from: 'jn_1650', to: 'je_475', distance: 12, corridor: 'East Corridor' },
  { from: 'je_475', to: 'je_625', distance: 15, corridor: 'East Corridor' },
  { from: 'je_625', to: 'je_775', distance: 15, corridor: 'East Corridor' },
  { from: 'je_775', to: 'je_925', distance: 15, corridor: 'East Corridor' },
  { from: 'je_925', to: 'js_1650', distance: 12, corridor: 'East Corridor' },
];

export function getPOIs() { return NODES.filter(n => n.type === 'poi' && n.poi); }
export function getNodeById(id) { return NODES.find(n => n.id === id) || null; }
export function getPOIsByCategory(category) { return getPOIs().filter(n => n.poi.category === category); }

export function buildAdjacencyList() {
  const adj = new Map();
  for (const node of NODES) adj.set(node.id, []);
  for (const edge of EDGES) {
    const isAccessible = edge.accessible !== false; // default true
    adj.get(edge.from)?.push({ to: edge.to, distance: edge.distance, accessible: isAccessible });
    adj.get(edge.to)?.push({ to: edge.from, distance: edge.distance, accessible: isAccessible });
  }
  return adj;
}
