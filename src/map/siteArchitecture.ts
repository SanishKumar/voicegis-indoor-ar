import {
  BoxGeometry,
  Color,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Path,
  Shape,
  Vector3,
} from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { insetPolygon, roundCorners, type Point } from './softGeometry';
import { withFinish } from './architecturalFinish';
import type { ToWorld } from './siteScenery';

type SiteBuilding = NonNullable<CompiledBuildingPackage['site']>['buildings'][number];
type Placement = { position: Vector3; scale: Vector3; angle?: number; tint?: number };
type Deck = { outline: readonly Point[]; courtyards?: readonly (readonly Point[])[] };

/** Exterior illustration. Room elevations and routing retain their authored geometry. */
export const siteBuildingHeight = (storeys: number) => 0.5 + storeys * 4.2;

/** A hospital envelope with glazed bays, floor bands and entrances at actual portals.
 * Parts are instanced per material. The caller fades the entire envelope together.
 */
export function createSiteArchitecture(
  building: SiteBuilding,
  portals: CompiledBuildingPackage['portals'],
  toWorld: ToWorld,
) {
  const group = new Group();
  const materials: MeshStandardMaterial[] = [];
  const geometries: Array<BoxGeometry | ExtrudeGeometry> = [];
  const instanceMeshes: InstancedMesh[] = [];
  const unitBox = new BoxGeometry(1, 1, 1);
  geometries.push(unitBox);
  const footprint = building.footprint as Point[];
  const xs = footprint.map(([x]) => x);
  const ys = footprint.map(([, y]) => y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const centre: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
  // Winding, not the bounds' centre, determines outside on concave footprints.
  const signedArea = footprint.reduce((area, point, index) => {
    const next = footprint[(index + 1) % footprint.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const height = siteBuildingHeight(building.storeys);
  const width = x1 - x0;
  const depth = y1 - y0;
  const rectangle =
    footprint.length === 4 &&
    footprint.every(([x, y]) => (x === x0 || x === x1) && (y === y0 || y === y1));
  const sculpted = rectangle && building.storeys > 2 && width > 75 && depth > 29;
  const emergency = building.id === 'emergency-centre';
  const wellness = building.id === 'wellness-pavilion';
  const podiumHeight = sculpted ? siteBuildingHeight(1) : height;
  const material = (color: number, roughness = 0.75, metalness = 0) => {
    const result = new MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent: true,
      opacity: 0.94,
    });
    materials.push(result);
    return result;
  };
  const stone = withFinish(
    material(emergency ? 0xbe8c72 : wellness ? 0xc6ab86 : 0xc2a68f),
    'masonry',
  );
  const trim = material(0xe5dfd0);
  const glass = withFinish(material(0x64848c, 0.32, 0.15), 'glazing');
  const roofDeck = withFinish(
    material(emergency ? 0x869192 : wellness ? 0x98a595 : 0xa39b87, 0.94),
    'roof',
  );
  const skylight = material(0x5c8995, 0.27, 0.12);

  const identify = <T extends Mesh>(mesh: T, name: string) => {
    mesh.name = name;
    mesh.userData.siteBuildingId = building.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const tile = (decks: Deck[], top: number, depth: number, bevel = 0.08) => {
    const trace = <T extends Path>(path: T, outline: readonly Point[]) => {
      outline.forEach((point, i) => {
        const world = toWorld(point);
        if (i === 0) path.moveTo(world.x, world.z);
        else path.lineTo(world.x, world.z);
      });
      path.closePath();
      return path;
    };
    const shapes = decks.map(({ outline, courtyards = [] }) => {
      const shape = trace(new Shape(), outline);
      shape.holes.push(...courtyards.map((ring) => trace(new Path(), ring)));
      return shape;
    });
    const geometry = new ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 2,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, top, 0);
    // Extrude creates two material groups per shape. Preserve that division
    // for the stone walls and roof, and combine the ranges for a single finish.
    geometries.push(geometry);
    return geometry;
  };
  const instances = (name: string, placements: Placement[], surface: MeshStandardMaterial) => {
    if (placements.length === 0) return;
    const mesh = identify(new InstancedMesh(unitBox, surface, placements.length), name);
    instanceMeshes.push(mesh);
    const scratch = new Object3D();
    const hasTint = placements.some((placement) => placement.tint !== undefined);
    const color = new Color();
    placements.forEach(({ position, scale, angle = 0, tint }, index) => {
      scratch.position.copy(position);
      scratch.scale.copy(scale);
      scratch.rotation.set(0, angle, 0);
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
      if (hasTint) mesh.setColorAt(index, color.setHex(tint ?? 0xffffff));
    });
    return mesh;
  };

  const podiumOutline = roundCorners(insetPolygon(footprint, 0.09), sculpted ? 3.4 : 2.5, 7);
  identify(
    new Mesh(tile([{ outline: podiumOutline }], podiumHeight, podiumHeight - 0.08), [
      roofDeck,
      stone,
    ]),
    'building-envelope',
  );
  const eaveOutline = roundCorners(insetPolygon(footprint, -0.22), sculpted ? 3.5 : 2.7, 7);
  identify(
    new Mesh(
      tile(
        [{ outline: eaveOutline, courtyards: [insetPolygon(eaveOutline, 1.45)] }],
        podiumHeight + 0.3,
        0.4,
      ),
      trim,
    ),
    'roof-eave',
  );

  // The two ward floors fill the occupied rectangle. Their facade bows out
  // over the gardens, returning to the entrance line at the central atrium.
  let wardOutline: Point[] = [];
  if (sculpted) {
    const line = new Shape();
    line.moveTo(x0 + 5, y0 - 0.2);
    line.bezierCurveTo(x0 + width * 0.24, y0 - 7, x0 + width * 0.35, y0 + 1.4, centre[0], y0);
    line.bezierCurveTo(x1 - width * 0.27, y0 - 1.4, x1 - width * 0.17, y0 - 5.5, x1 - 4, y0);
    line.quadraticCurveTo(x1 + 2.8, y0 + 2, x1 + 1.2, centre[1]);
    line.quadraticCurveTo(x1 + 2.5, y1 - 1, x1 - 4, y1 + 1.2);
    line.bezierCurveTo(x1 - width * 0.18, y1 + 6, x1 - width * 0.28, y1 + 3.6, centre[0] + 7, y1);
    line.bezierCurveTo(centre[0] - 7, y1 - 0.6, x0 + width * 0.24, y1 + 7.5, x0 + 4, y1 + 1);
    line.quadraticCurveTo(x0 - 3.4, y1 - 3, x0 - 1.3, centre[1]);
    line.quadraticCurveTo(x0 - 3.2, y0 + 1.2, x0 + 5, y0 - 0.2);
    // Sample at facade-bay spacing along the curve. The roof and windows
    // use the same vertices so glazing stays on the enclosure around bends.
    const count = Math.ceil(line.getLength() / 3.2);
    wardOutline = line
      .getSpacedPoints(count)
      .slice(0, -1)
      .map(({ x, y }) => [x, y]);
    identify(
      new Mesh(tile([{ outline: wardOutline }], height, height - podiumHeight), [roofDeck, trim]),
      'ward-wings',
    );
  }

  const windows: Placement[] = [];
  const bands: Placement[] = [];
  const fins: Placement[] = [];
  const entrances: Placement[] = [];
  const canopies: Placement[] = [];
  const columns: Placement[] = [];
  const glassTones = [0xc5d3d2, 0xdcdfd6, 0xabbcc0, 0xf0eada, 0xcedcde];
  let atriumX = centre[0];
  const entryPortals = new Set<string>();

  for (let i = 0; i < footprint.length; i += 1) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 3) continue;
    const direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const normal: Point =
      signedArea >= 0 ? [direction[1], -direction[0]] : [-direction[1], direction[0]];
    const startWorld = toWorld(a);
    const endWorld = toWorld(b);
    const angle = Math.atan2(-(endWorld.z - startWorld.z), endWorld.x - startWorld.x);
    const at = (distance: number, offset: number, elevation: number) =>
      toWorld(
        [
          a[0] + direction[0] * distance + normal[0] * offset,
          a[1] + direction[1] * distance + normal[1] * offset,
        ],
        elevation,
      );
    const entries = portals.filter((portal) => {
      const along =
        (portal.position[0] - a[0]) * direction[0] + (portal.position[1] - a[1]) * direction[1];
      const across = Math.abs(
        (portal.position[0] - a[0]) * normal[0] + (portal.position[1] - a[1]) * normal[1],
      );
      return along >= 2 && along <= length - 2 && across < 0.35 && !entryPortals.has(portal.id);
    });
    for (const portal of entries) {
      entryPortals.add(portal.id);
      if (sculpted) atriumX = portal.position[0];
      const along =
        (portal.position[0] - a[0]) * direction[0] + (portal.position[1] - a[1]) * direction[1];
      const width = Math.min(length - 4, Math.max(building.storeys > 1 ? 16 : 8, portal.width + 7));
      const canopyHeight = building.storeys > 1 ? 4.7 : 3.6;
      const projection = building.storeys > 1 ? 8 : 6;
      entrances.push({
        position: at(along, 0.18, 1.9),
        scale: new Vector3(portal.width + 1.5, 3.1, 0.25),
        angle,
      });
      canopies.push({
        position: at(along, projection / 2 - 0.5, canopyHeight),
        scale: new Vector3(width, 0.35, projection),
        angle,
      });
      bands.push({
        position: at(along, projection - 0.5, canopyHeight - 0.1),
        scale: new Vector3(width, 0.36, 0.17),
        angle,
        tint: emergency ? 0x9d443b : wellness ? 0x827750 : 0x46666b,
      });
      for (const offset of [-width / 2 + 0.7, width / 2 - 0.7]) {
        columns.push({
          position: at(along + offset, projection - 1.2, canopyHeight / 2),
          scale: new Vector3(0.3, canopyHeight, 0.3),
          angle,
        });
      }
    }
    const bays = Math.max(1, Math.floor((length - 4) / 3.8));
    const spacing = (length - 4) / bays;
    for (let bay = 0; bay < bays; bay += 1) {
      const along = 2 + spacing * (bay + 0.5);
      for (let level = 0; level < (sculpted ? 1 : building.storeys); level += 1) {
        const inEntry =
          level === 0 &&
          entries.some((entry) => {
            const entryAlong =
              (entry.position[0] - a[0]) * direction[0] + (entry.position[1] - a[1]) * direction[1];
            return Math.abs(entryAlong - along) < entry.width / 2 + 1;
          });
        if (!inEntry) {
          windows.push({
            position: at(along, 0.12, 2.15 + level * 4.2),
            scale: new Vector3(Math.min(2.65, spacing - 0.7), 2.35, 0.24),
            angle,
            tint: glassTones[(bay + level * 3) % glassTones.length],
          });
          // Sill shades project from the wall and throw a narrow shadow above
          // each glazed bay. Keep the large ground-floor door clear.
          bands.push({
            position: at(along, 0.33, 3.38 + level * 4.2),
            scale: new Vector3(Math.min(3.14, spacing - 0.22), 0.16, 0.84),
            angle,
          });
        }
      }
      fins.push({
        position: at(along - spacing / 2, 0.22, podiumHeight / 2),
        scale: new Vector3(wellness ? 0.36 : 0.2, podiumHeight - 0.5, wellness ? 0.75 : 0.42),
        angle,
      });
    }
    for (let level = 1; level <= (sculpted ? 1 : building.storeys); level += 1) {
      bands.push({
        position: at(length / 2, 0.16, 0.35 + level * 4.2),
        scale: new Vector3(length - 2, 0.2, 0.5),
        angle,
      });
    }
  }
  for (let bay = 0; bay < wardOutline.length; bay++) {
    const a = toWorld(wardOutline[bay]);
    const b = toWorld(wardOutline[(bay + 1) % wardOutline.length]);
    const span = a.distanceTo(b);
    const angle = Math.atan2(a.z - b.z, b.x - a.x);
    const mid = a.clone().lerp(b, 0.5);
    // wardOutline runs clockwise in screen coordinates. Extrude and toWorld
    // may reflect the vertical plan axis, so derive the outward side in plan.
    const start = wardOutline[bay],
      end = wardOutline[(bay + 1) % wardOutline.length];
    const outward = toWorld([
      start[0] + (end[1] - start[1]) / span,
      start[1] - (end[0] - start[0]) / span,
    ]).sub(a);
    const at = (h: number, offset: number) => mid.clone().addScaledVector(outward, offset).setY(h);
    for (let level = 1; level < building.storeys; level++) {
      windows.push({
        position: at(2.15 + level * 4.2, 0.13),
        scale: new Vector3(span - 0.18, 2.5, 0.24),
        angle,
        tint: glassTones[(bay + level * 2) % glassTones.length],
      });
      fins.push({
        position: at(2.15 + level * 4.2, 0.27),
        scale: new Vector3(0.07, 2.52, 0.14),
        angle,
      });
      bands.push({
        position: at(3.54 + level * 4.2, 0.34),
        scale: new Vector3(span + 0.08, 0.22, 0.82),
        angle,
      });
    }
  }
  instances('facade-windows', windows, glass);
  instances('facade-floor-bands', bands, trim);
  instances('entrance-glazing', entrances, glass);
  instances('entrance-canopy', canopies, trim);
  instances('entrance-columns', columns, stone);

  // Elevated light courts sit on the deck. Their open centres expose the
  // terrace below. Keep these volumes inside the rectangular roof they fit.
  const courts: Shape[] = [];
  const roofCaps: Shape[] = [];
  if (rectangle && width > 60 && depth >= 22) {
    for (const side of [-1, 1]) {
      const cx = centre[0] + side * width * 0.26;
      const cy = centre[1];
      const outline = (overhang: number) => {
        const shape = new Shape();
        for (const inner of [false, true]) {
          const path = inner ? new Path() : shape;
          for (let i = 0; i <= 48; i++) {
            const angle = ((inner ? -1 : 1) * i * Math.PI) / 24;
            const rx = width * (inner ? 0.095 : 0.215) + (inner ? -1 : 1) * overhang;
            const ry = depth * (inner ? 0.166 : 0.385) + (inner ? -1 : 1) * overhang;
            const x = cx + Math.cos(angle) * rx + (inner ? side * width * 0.035 : 0);
            const y =
              cy +
              Math.sin(angle) * ry * (1 + side * 0.26 * Math.cos(angle)) +
              side * depth * 0.09 * Math.cos(angle);
            const p = toWorld([x, y]);
            if (i === 0) path.moveTo(p.x, p.z);
            else path.lineTo(p.x, p.z);
            if (overhang === 0 && i < 48 && i % 2 === 0) {
              fins.push({
                position: toWorld([x, y], height + 1.55),
                scale: new Vector3(0.24, 2.55, 0.24),
              });
            }
          }
          path.closePath();
          if (inner) shape.holes.push(path);
        }
        return shape;
      };
      courts.push(outline(0));
      roofCaps.push(outline(0.42));
    }
    const courtMesh = (
      shapes: Shape[],
      top: number,
      thickness: number,
      surface: MeshStandardMaterial,
      name: string,
    ) => {
      const geometry = new ExtrudeGeometry(shapes, { depth: thickness, bevelEnabled: false });
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, top, 0);
      geometries.push(geometry);
      identify(new Mesh(geometry, surface), name);
    };
    courtMesh(courts, height + 2.85, 2.55, glass, 'glazed-light-courts');
    courtMesh(
      roofCaps,
      height + 3.26,
      0.42,
      withFinish(material(0xd2c9b6), 'roof'),
      'light-court-coping',
    );
  }
  instances('facade-fins', fins, trim);

  // Tuck the mechanical plant against the rear parapet. Keep a clear strip
  // beside each unit and split the bank into housings, louvers and ductwork.
  if (rectangle && width >= 32 && depth >= 25) {
    const hardware: Placement[] = [];
    const colors: number[] = [];
    const add = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
    ) => {
      hardware.push({ position: toWorld([x, y], height + z), scale: new Vector3(w, h, d) });
      colors.push(color);
    };
    const units = Math.max(2, Math.min(5, Math.floor(width / 18)));
    for (let i = 0; i < units; i++) {
      const x = centre[0] + (i - (units - 1) / 2) * 5.3;
      const y = y0 + 3.2;
      add(x, y, 1.03, 3.8, 1.2, 1.7, 0xc2c4b9);
      add(x, y, 1.68, 4, 0.14, 1.9, 0xe4e3d4);
      add(x, y + 0.87, 1.12, 3.35, 0.66, 0.08, 0x596768);
      for (let k = 0; k < 4; k++) add(x, y + 0.94, 0.86 + k * 0.17, 3.4, 0.06, 0.12, 0x9ea8a2);
      add(x, y, 1.78, 2.5, 0.12, 1.05, 0x7b8380);
    }
    add(centre[0], y0 + 4.8, 0.71, units * 5.2, 0.58, 0.68, 0xb2b7b0);
    if (wellness) {
      // Two timber pergolas shade the planted terrace. Their beams span
      // north–south, leaving the entrance side open to the healing garden.
      for (const side of [-1, 1]) {
        const x = centre[0] + side * width * 0.17;
        const y = centre[1] - 1;
        for (const u of [-4, 4]) {
          for (const v of [-4.6, 4.6]) add(x + u, y + v, 1.75, 0.26, 2.9, 0.26, 0x8e7756);
          add(x + u, y, 3.24, 0.24, 0.32, 10.1, 0x957951);
        }
        for (let k = -5; k <= 5; k++) add(x, y + k * 0.92, 3.48, 9.2, 0.25, 0.36, 0xb89c75);
        for (const v of [-5.4, 5.4]) {
          add(x, y + v, 0.66, 9, 0.55, 1.15, 0xa49780);
          add(x, y + v, 1.02, 8.7, 0.3, 0.93, 0x657a53);
        }
      }
    }
    if (courts.length) {
      for (const side of [-1, 1]) {
        const x = centre[0] + side * width * 0.295;
        for (const row of [-1, 1]) {
          add(
            x,
            centre[1] + row * depth * 0.057,
            0.63,
            width * 0.092,
            0.48,
            depth * 0.048,
            0xa09276,
          );
          add(
            x,
            centre[1] + row * depth * 0.057,
            0.93,
            width * 0.088,
            0.32,
            depth * 0.044,
            0x839369,
          );
        }
      }
    }
    // Photovoltaic panels on the compact pavilions; the central vault and
    // the larger light courts occupy this part of the main building's deck.
    if (courts.length === 0) {
      const rows = Math.min(3, Math.floor((depth / 2 - 9) / 2.4));
      const count = Math.min(8, Math.floor((width - 10) / 3.2));
      for (let row = 0; row < rows; row++)
        for (let i = 0; i < count; i++) {
          const x = centre[0] + (i - (count - 1) / 2) * 3.2;
          const y = y1 - 3.8 - row * 2.4;
          add(x, y, 0.63, 3, 0.27, 1.78, 0xb4b9ae);
          add(x, y, 0.79, 2.87, 0.08, 1.67, 0x405c67);
        }
    }
    const mesh = instances('roof-services', hardware, material(0xffffff));
    colors.forEach((color, i) => mesh?.setColorAt(i, new Color(color)));
  }

  // Barrel vault with ribs following the glass at each station.
  const lanternWidth = Math.min(sculpted ? 17 : 21, width * 0.4);
  const lanternDepth = Math.min(sculpted ? 24 : 12, depth * 0.56);
  const lanternCentre: Point = [sculpted ? atriumX : centre[0], centre[1]];
  const inset = insetPolygon(footprint, 4);
  const inside = ([x, y]: Point) => {
    let included = false;
    for (let i = 0, j = inset.length - 1; i < inset.length; j = i, i += 1) {
      const [xi, yi] = inset[i];
      const [xj, yj] = inset[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) included = !included;
    }
    return included;
  };
  const lantern: Point[] = [
    [lanternCentre[0] - lanternWidth / 2, centre[1] - lanternDepth / 2],
    [lanternCentre[0] + lanternWidth / 2, centre[1] - lanternDepth / 2],
    [lanternCentre[0] + lanternWidth / 2, centre[1] + lanternDepth / 2],
    [lanternCentre[0] - lanternWidth / 2, centre[1] + lanternDepth / 2],
  ];
  if (!wellness && lanternWidth >= 9 && lanternDepth >= 7 && lantern.every(inside)) {
    const radius = lanternDepth / 2;
    const rise = Math.min(4.7, radius * 0.71);
    const section = new Shape();
    section.moveTo(-radius, 0);
    section.absellipse(0, 0, radius, rise, Math.PI, 0, true, 0);
    section.closePath();
    const layer = (length: number) => {
      const g = new ExtrudeGeometry(section, {
        depth: length,
        bevelEnabled: false,
        curveSegments: 12,
      });
      g.rotateY(Math.PI / 2);
      geometries.push(g);
      return g;
    };
    const origin = toWorld(lanternCentre, height + 0.41);
    const vault = identify(new Mesh(layer(lanternWidth), skylight), 'roof-lantern');
    vault.position.copy(origin);
    vault.position.x -= lanternWidth / 2;
    const count = Math.max(3, Math.floor(lanternWidth / 3));
    const ribs = new InstancedMesh(layer(0.13), trim, count + 1);
    const rib = new Object3D();
    for (let i = 0; i <= count; i++) {
      rib.position.copy(vault.position);
      rib.position.x += ((lanternWidth - 0.13) * i) / count;
      rib.scale.set(1, 1 + 0.08 / rise, 1 + 0.08 / radius);
      rib.updateMatrix();
      ribs.setMatrixAt(i, rib.matrix);
    }
    identify(ribs, 'roof-lantern-ribs');
    instanceMeshes.push(ribs);
  }

  return {
    group,
    materials,
    height,
    dispose() {
      for (const mesh of instanceMeshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const surface of materials) surface.dispose();
    },
  };
}
