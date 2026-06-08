/**
 * buildingGraph.js
 * 
 * Data model for the hospital wing floorplan.
 * Defines all navigable nodes (intersections + POIs), edges (corridors),
 * and POI metadata.
 * 
 * Coordinate system: SVG viewBox units (0-800 x 0-500)
 * Designed for single-floor MVP with floor_id for future multi-floor support.
 * 
 * @module data/buildingGraph
 */

/**
 * POI Category definitions with display metadata.
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

/**
 * All navigable nodes in the hospital wing.
 * Types: 'poi' (point of interest / room) or 'junction' (corridor intersection)
 */
export const NODES = [
  // ── Entrances ──
  { id: 'entrance-main', x: 400, y: 460, floor: 1, type: 'poi', poi: { name: 'Main Entrance', category: 'entrance', icon: '🚪', description: 'Hospital main entrance and reception lobby' } },
  
  // ── Main corridor junctions ──
  { id: 'j1',  x: 400, y: 400, floor: 1, type: 'junction' },
  { id: 'j2',  x: 400, y: 300, floor: 1, type: 'junction' },
  { id: 'j3',  x: 400, y: 200, floor: 1, type: 'junction' },
  { id: 'j4',  x: 400, y: 120, floor: 1, type: 'junction' },
  
  // ── Left wing junctions ──
  { id: 'j5',  x: 200, y: 300, floor: 1, type: 'junction' },
  { id: 'j6',  x: 100, y: 300, floor: 1, type: 'junction' },
  { id: 'j7',  x: 200, y: 200, floor: 1, type: 'junction' },
  
  // ── Right wing junctions ──
  { id: 'j8',  x: 600, y: 300, floor: 1, type: 'junction' },
  { id: 'j9',  x: 700, y: 300, floor: 1, type: 'junction' },
  { id: 'j10', x: 600, y: 200, floor: 1, type: 'junction' },
  
  // ── Emergency Department (Left, upper) ──
  { id: 'er', x: 100, y: 200, floor: 1, type: 'poi', poi: { name: 'Emergency Room', category: 'emergency', icon: '🚨', description: 'Emergency department — 24/7 critical care and triage' } },
  
  // ── Medical Rooms (Left wing) ──
  { id: 'icu', x: 100, y: 380, floor: 1, type: 'poi', poi: { name: 'ICU', category: 'medical', icon: '🫀', description: 'Intensive Care Unit — critical patient monitoring' } },
  { id: 'ward-a', x: 200, y: 380, floor: 1, type: 'poi', poi: { name: 'Ward A', category: 'medical', icon: '🛏️', description: 'General ward — beds 101-120' } },
  
  // ── Diagnostic (Center-left) ──
  { id: 'radiology', x: 200, y: 120, floor: 1, type: 'poi', poi: { name: 'Radiology', category: 'diagnostic', icon: '📡', description: 'X-ray, CT scan, and MRI imaging center' } },
  { id: 'lab', x: 300, y: 120, floor: 1, type: 'poi', poi: { name: 'Laboratory', category: 'diagnostic', icon: '🔬', description: 'Blood tests, pathology, and sample analysis' } },
  
  // ── Admin & Reception (Center) ──
  { id: 'reception', x: 400, y: 380, floor: 1, type: 'poi', poi: { name: 'Reception', category: 'admin', icon: '📋', description: 'Patient registration and information desk' } },
  { id: 'admin-office', x: 500, y: 120, floor: 1, type: 'poi', poi: { name: 'Admin Office', category: 'admin', icon: '🏢', description: 'Hospital administration and billing' } },
  
  // ── Pharmacy ──
  { id: 'pharmacy', x: 300, y: 380, floor: 1, type: 'poi', poi: { name: 'Pharmacy', category: 'pharmacy', icon: '💊', description: 'Prescription pickup and over-the-counter medicines' } },
  
  // ── Right wing — Medical ──
  { id: 'ward-b', x: 600, y: 380, floor: 1, type: 'poi', poi: { name: 'Ward B', category: 'medical', icon: '🛏️', description: 'General ward — beds 201-220' } },
  { id: 'surgery', x: 700, y: 200, floor: 1, type: 'poi', poi: { name: 'Surgery', category: 'medical', icon: '🏥', description: 'Operating theatres 1-4 — scheduled surgeries' } },
  { id: 'pediatrics', x: 700, y: 380, floor: 1, type: 'poi', poi: { name: 'Pediatrics', category: 'medical', icon: '👶', description: 'Children\'s care department — ages 0-16' } },
  
  // ── Right wing — Diagnostic ──
  { id: 'cardiology', x: 600, y: 120, floor: 1, type: 'poi', poi: { name: 'Cardiology', category: 'diagnostic', icon: '❤️', description: 'Heart health — ECG, echo, and cardiac consultations' } },
  
  // ── Services ──
  { id: 'cafeteria', x: 100, y: 420, floor: 1, type: 'poi', poi: { name: 'Cafeteria', category: 'service', icon: '🍽️', description: 'Food court — breakfast, lunch, snacks, and beverages' } },
  { id: 'restroom-1', x: 300, y: 250, floor: 1, type: 'poi', poi: { name: 'Restroom', category: 'restroom', icon: '🚻', description: 'Public restroom facilities' } },
  
  // ── Junction for restroom connection ──
  { id: 'j11', x: 300, y: 300, floor: 1, type: 'junction' },
  { id: 'j12', x: 500, y: 300, floor: 1, type: 'junction' },
  { id: 'j13', x: 300, y: 200, floor: 1, type: 'junction' },
  { id: 'j14', x: 500, y: 200, floor: 1, type: 'junction' },
  { id: 'j15', x: 100, y: 200, floor: 1, type: 'junction' }, // ER junction
  { id: 'j16', x: 700, y: 200, floor: 1, type: 'junction' }, // Surgery junction
];

/**
 * Edges connecting nodes. Each edge represents a walkable corridor segment.
 * Distance is in meters (approximate for demo).
 */
export const EDGES = [
  // Main vertical corridor
  { from: 'entrance-main', to: 'j1',  distance: 8,  corridor: 'Main Lobby' },
  { from: 'j1',  to: 'j2',  distance: 12, corridor: 'Central Corridor' },
  { from: 'j2',  to: 'j3',  distance: 12, corridor: 'Central Corridor' },
  { from: 'j3',  to: 'j4',  distance: 10, corridor: 'Central Corridor' },
  
  // Left horizontal corridor (y=300)
  { from: 'j2',  to: 'j11', distance: 10, corridor: 'West Corridor' },
  { from: 'j11', to: 'j5',  distance: 10, corridor: 'West Corridor' },
  { from: 'j5',  to: 'j6',  distance: 12, corridor: 'West Corridor' },
  
  // Right horizontal corridor (y=300)
  { from: 'j2',  to: 'j12', distance: 10, corridor: 'East Corridor' },
  { from: 'j12', to: 'j8',  distance: 10, corridor: 'East Corridor' },
  { from: 'j8',  to: 'j9',  distance: 12, corridor: 'East Corridor' },
  
  // Left wing vertical connectors
  { from: 'j5',  to: 'j7',  distance: 12, corridor: 'West Wing' },
  { from: 'j6',  to: 'j15', distance: 12, corridor: 'Emergency Wing' },
  
  // Right wing vertical connectors
  { from: 'j8',  to: 'j10', distance: 12, corridor: 'East Wing' },
  { from: 'j9',  to: 'j16', distance: 12, corridor: 'Surgery Wing' },
  
  // Upper horizontal corridor (y=200)
  { from: 'j15', to: 'j7',  distance: 12, corridor: 'North Corridor' },
  { from: 'j7',  to: 'j13', distance: 10, corridor: 'North Corridor' },
  { from: 'j13', to: 'j3',  distance: 10, corridor: 'North Corridor' },
  { from: 'j3',  to: 'j14', distance: 10, corridor: 'North Corridor' },
  { from: 'j14', to: 'j10', distance: 10, corridor: 'North Corridor' },
  { from: 'j10', to: 'j16', distance: 12, corridor: 'North Corridor' },
  
  // ── POI connections ──
  // Entrance
  { from: 'j1',  to: 'reception', distance: 3, corridor: 'Lobby' },
  
  // Left wing POIs
  { from: 'j6',  to: 'icu', distance: 5,  corridor: 'ICU Access' },
  { from: 'j6',  to: 'cafeteria', distance: 6, corridor: 'Service Corridor' },
  { from: 'j5',  to: 'ward-a', distance: 5, corridor: 'Ward A Access' },
  { from: 'j15', to: 'er', distance: 2, corridor: 'ER Access' },
  
  // Center POIs
  { from: 'j11', to: 'pharmacy', distance: 5, corridor: 'Pharmacy Access' },
  { from: 'j11', to: 'restroom-1', distance: 5, corridor: 'Restroom Access' },
  { from: 'j13', to: 'radiology', distance: 5, corridor: 'Radiology Access' },
  { from: 'j13', to: 'lab', distance: 3, corridor: 'Lab Corridor' },
  { from: 'j4',  to: 'lab', distance: 5, corridor: 'Lab Corridor' },
  
  // Right wing POIs
  { from: 'j8',  to: 'ward-b', distance: 5, corridor: 'Ward B Access' },
  { from: 'j9',  to: 'pediatrics', distance: 5, corridor: 'Pediatrics Access' },
  { from: 'j16', to: 'surgery', distance: 2, corridor: 'Surgery Access' },
  { from: 'j10', to: 'cardiology', distance: 5, corridor: 'Cardiology Access' },
  { from: 'j14', to: 'admin-office', distance: 5, corridor: 'Admin Access' },
  { from: 'j4',  to: 'admin-office', distance: 5, corridor: 'Admin Access' },
];

/**
 * Get all POI nodes (nodes with poi data).
 */
export function getPOIs() {
  return NODES.filter(n => n.type === 'poi' && n.poi);
}

/**
 * Get a node by its ID.
 */
export function getNodeById(id) {
  return NODES.find(n => n.id === id) || null;
}

/**
 * Get POIs filtered by category.
 */
export function getPOIsByCategory(category) {
  return getPOIs().filter(n => n.poi.category === category);
}

/**
 * Build an adjacency list representation of the graph.
 * Returns Map<nodeId, Array<{ to: string, distance: number, corridor: string }>>
 */
export function buildAdjacencyList() {
  const adj = new Map();
  
  for (const node of NODES) {
    adj.set(node.id, []);
  }
  
  for (const edge of EDGES) {
    adj.get(edge.from)?.push({ to: edge.to, distance: edge.distance, corridor: edge.corridor });
    adj.get(edge.to)?.push({ to: edge.from, distance: edge.distance, corridor: edge.corridor });
  }
  
  return adj;
}
