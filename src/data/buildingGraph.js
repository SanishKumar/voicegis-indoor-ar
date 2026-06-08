/**
 * buildingGraph.js
 * 
 * Scaled 3000x2000 complex routing graph for the Mega-Hospital layout.
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
  // ── Entrance ──
  { id: 'entrance-main', x: 1400, y: 1350, floor: 1, type: 'poi', poi: { name: 'Main Entrance', category: 'entrance', icon: '🚪', description: 'South Atrium Entrance' } },
  
  // ── POIs (Centers of rooms) ──
  { id: 'icu',        x: 350, y: 1000, floor: 1, type: 'poi', poi: { name: 'Intensive Care Unit', category: 'medical', icon: '🫀', description: 'West Wing' } },
  { id: 'er',         x: 700, y: 1100, floor: 1, type: 'poi', poi: { name: 'Emergency Room', category: 'emergency', icon: '🚨', description: 'West Wing Triage' } },
  { id: 'lab',        x: 1350, y: 350, floor: 1, type: 'poi', poi: { name: 'Laboratory', category: 'diagnostic', icon: '🔬', description: 'North Wing' } },
  { id: 'radiology',  x: 1650, y: 450, floor: 1, type: 'poi', poi: { name: 'Radiology', category: 'diagnostic', icon: '📡', description: 'North Wing' } },
  { id: 'surgery',    x: 2450, y: 1000, floor: 1, type: 'poi', poi: { name: 'Surgery Center', category: 'medical', icon: '🏥', description: 'East Wing' } },
  { id: 'pediatrics', x: 2100, y: 1100, floor: 1, type: 'poi', poi: { name: 'Pediatrics', category: 'medical', icon: '👶', description: 'East Wing' } },
  { id: 'cafeteria',  x: 1350, y: 1650, floor: 1, type: 'poi', poi: { name: 'Cafeteria', category: 'service', icon: '🍽️', description: 'South Wing' } },
  { id: 'ward-a',     x: 1650, y: 1550, floor: 1, type: 'poi', poi: { name: 'Ward A', category: 'medical', icon: '🛏️', description: 'South Wing' } },
  { id: 'ward-b',     x: 1650, y: 1800, floor: 1, type: 'poi', poi: { name: 'Ward B', category: 'medical', icon: '🛏️', description: 'South Wing' } },
  { id: 'reception',  x: 1400, y: 1010, floor: 1, type: 'poi', poi: { name: 'Main Reception', category: 'admin', icon: '📋', description: 'Central Atrium' } },
  { id: 'pharmacy',   x: 1100, y: 1200, floor: 1, type: 'poi', poi: { name: 'Pharmacy', category: 'pharmacy', icon: '💊', description: 'Central Atrium' } },
  { id: 'restroom-1', x: 1700, y: 800,  floor: 1, type: 'poi', poi: { name: 'Restroom', category: 'restroom', icon: '🚻', description: 'Central Atrium' } },

  // ── Atrium Intersections ──
  { id: 'j_A_C',  x: 1400, y: 1000, floor: 1, type: 'junction' },
  { id: 'j_A_NW', x: 1200, y: 800,  floor: 1, type: 'junction' },
  { id: 'j_A_NE', x: 1600, y: 800,  floor: 1, type: 'junction' },
  { id: 'j_A_SW', x: 1200, y: 1200, floor: 1, type: 'junction' },
  { id: 'j_A_SE', x: 1600, y: 1200, floor: 1, type: 'junction' },

  // ── Wing Hubs (Corridors) ──
  { id: 'j_N_Hub', x: 1400, y: 650, floor: 1, type: 'junction' },
  { id: 'j_S_Hub', x: 1400, y: 1350, floor: 1, type: 'junction' },
  { id: 'j_W_Hub', x: 950, y: 1000, floor: 1, type: 'junction' },
  { id: 'j_E_Hub', x: 1850, y: 1000, floor: 1, type: 'junction' },

  // ── Deep Wing Nodes ──
  { id: 'j_N_1', x: 1350, y: 650, floor: 1, type: 'junction' },
  { id: 'j_N_2', x: 1650, y: 650, floor: 1, type: 'junction' },
  
  { id: 'j_S_1', x: 1350, y: 1350, floor: 1, type: 'junction' },
  { id: 'j_S_2', x: 1650, y: 1350, floor: 1, type: 'junction' },
  { id: 'j_S_3', x: 1650, y: 1650, floor: 1, type: 'junction' },

  { id: 'j_W_1', x: 950, y: 1100, floor: 1, type: 'junction' },
  { id: 'j_E_1', x: 1850, y: 1100, floor: 1, type: 'junction' },
];

export const EDGES = [
  // Atrium Diamond
  { from: 'j_A_C', to: 'j_A_NW', distance: 28, corridor: 'Main Atrium' },
  { from: 'j_A_C', to: 'j_A_NE', distance: 28, corridor: 'Main Atrium' },
  { from: 'j_A_C', to: 'j_A_SW', distance: 28, corridor: 'Main Atrium' },
  { from: 'j_A_C', to: 'j_A_SE', distance: 28, corridor: 'Main Atrium' },

  // Atrium to Hubs
  { from: 'j_A_C', to: 'j_N_Hub', distance: 35, corridor: 'North Atrium Connector' },
  { from: 'j_A_C', to: 'j_S_Hub', distance: 35, corridor: 'South Atrium Connector' },
  { from: 'j_A_C', to: 'j_W_Hub', distance: 45, corridor: 'West Atrium Connector' },
  { from: 'j_A_C', to: 'j_E_Hub', distance: 45, corridor: 'East Atrium Connector' },

  // Hubs to Deep Nodes
  { from: 'j_N_Hub', to: 'j_N_1', distance: 5, corridor: 'North Wing Corridor' },
  { from: 'j_N_Hub', to: 'j_N_2', distance: 25, corridor: 'North Wing Corridor' },
  
  { from: 'j_S_Hub', to: 'j_S_1', distance: 5, corridor: 'South Wing Corridor' },
  { from: 'j_S_Hub', to: 'j_S_2', distance: 25, corridor: 'South Wing Corridor' },
  { from: 'j_S_2',   to: 'j_S_3', distance: 30, corridor: 'South Wing Corridor' },

  { from: 'j_W_Hub', to: 'j_W_1', distance: 10, corridor: 'West Wing Corridor' },
  { from: 'j_E_Hub', to: 'j_E_1', distance: 10, corridor: 'East Wing Corridor' },

  // POIs to Atrium
  { from: 'entrance-main', to: 'j_S_Hub', distance: 5, corridor: 'Lobby' },
  { from: 'reception', to: 'j_A_C', distance: 5, corridor: 'Atrium' },
  { from: 'pharmacy', to: 'j_A_SW', distance: 10, corridor: 'Atrium West' },
  { from: 'restroom-1', to: 'j_A_NE', distance: 10, corridor: 'Atrium East' },

  // POIs to North Wing
  { from: 'lab', to: 'j_N_1', distance: 30, corridor: 'Lab Access' },
  { from: 'radiology', to: 'j_N_2', distance: 20, corridor: 'Radiology Access' },

  // POIs to South Wing
  { from: 'cafeteria', to: 'j_S_1', distance: 30, corridor: 'Cafeteria Access' },
  { from: 'ward-a', to: 'j_S_2', distance: 20, corridor: 'Ward A Access' },
  { from: 'ward-b', to: 'j_S_3', distance: 15, corridor: 'Ward B Access' },

  // POIs to West Wing
  { from: 'icu', to: 'j_W_Hub', distance: 60, corridor: 'ICU Access' },
  { from: 'er', to: 'j_W_1', distance: 25, corridor: 'ER Access' },

  // POIs to East Wing
  { from: 'surgery', to: 'j_E_Hub', distance: 60, corridor: 'Surgery Access' },
  { from: 'pediatrics', to: 'j_E_1', distance: 25, corridor: 'Pediatrics Access' },
];

export function getPOIs() {
  return NODES.filter(n => n.type === 'poi' && n.poi);
}

export function getNodeById(id) {
  return NODES.find(n => n.id === id) || null;
}

export function getPOIsByCategory(category) {
  return getPOIs().filter(n => n.poi.category === category);
}

export function buildAdjacencyList() {
  const adj = new Map();
  for (const node of NODES) adj.set(node.id, []);
  for (const edge of EDGES) {
    adj.get(edge.from)?.push({ to: edge.to, distance: edge.distance, corridor: edge.corridor });
    adj.get(edge.to)?.push({ to: edge.from, distance: edge.distance, corridor: edge.corridor });
  }
  return adj;
}
