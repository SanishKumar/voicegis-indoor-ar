import { describe, expect, it } from 'vitest';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import reference from '../../buildings/reference-medical-centre/compiled/building.package.json';
import asterion from '../../buildings/asterion-medical-center/compiled/building.package.json';
import harbor from '../../buildings/harbor-exchange/compiled/building.package.json';
import campus from '../../buildings/meridian-park-campus/compiled/building.package.json';
import {
  furnishRoom,
  roomUse,
  roomsOfFloor,
  type FurniturePart,
  type RoomToFurnish,
} from './roomInteriors';
import type { Point } from './softGeometry';

const VENUES = {
  reference,
  asterion,
  harbor,
  campus,
} as unknown as Record<string, CompiledBuildingPackage>;

function everyRoom(venue: CompiledBuildingPackage) {
  return venue.floors.flatMap((floor) => roomsOfFloor(venue, floor.id));
}

/** The floor a solid covers, as a rectangle. A ring or a ball is as wide as it is long. */
function footprint(part: FurniturePart) {
  const round = part.shape === 'ring' || part.shape === 'sphere';
  const halfX = part.size[0] / 2;
  const halfY = (round ? part.size[0] : part.size[1]) / 2;
  return {
    minX: part.position[0] - halfX,
    maxX: part.position[0] + halfX,
    minY: part.position[1] - halfY,
    maxY: part.position[1] + halfY,
  };
}

/** How near a rectangle comes to a line, sampled along the line. */
function gapToLane(rect: ReturnType<typeof footprint>, lane: readonly [Point, Point]) {
  let nearest = Infinity;
  for (let step = 0; step <= 40; step += 1) {
    const t = step / 40;
    const x = lane[0][0] + (lane[1][0] - lane[0][0]) * t;
    const y = lane[0][1] + (lane[1][1] - lane[0][1]) * t;
    const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
    const dy = Math.max(rect.minY - y, 0, y - rect.maxY);
    nearest = Math.min(nearest, Math.hypot(dx, dy));
  }
  return nearest;
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

describe('what is in a room', () => {
  for (const [name, venue] of Object.entries(VENUES)) {
    describe(name, () => {
      const rooms = everyRoom(venue);

      it('keeps every piece inside its room', () => {
        for (const room of rooms) {
          for (const part of furnishRoom(room)) {
            const rect = footprint(part);
            for (const corner of [
              [rect.minX, rect.minY],
              [rect.maxX, rect.minY],
              [rect.maxX, rect.maxY],
              [rect.minX, rect.maxY],
            ] as Point[]) {
              expect(
                pointInPolygon(corner, room.polygon),
                `${part.item} in ${room.name} at ${part.position.join(',')}`,
              ).toBe(true);
            }
          }
        }
      });

      it('never puts anything where a route can be drawn', () => {
        for (const room of rooms) {
          for (const part of furnishRoom(room)) {
            const rect = footprint(part);
            for (const lane of room.lanes) {
              // The route is a metre wide; half of that, and room to see it.
              expect(
                gapToLane(rect, lane),
                `${part.item} in ${room.name} on a route line`,
              ).toBeGreaterThan(0.7);
            }
          }
        }
      });

      it('never covers a pin or stands in a doorway', () => {
        for (const room of rooms) {
          for (const part of furnishRoom(room)) {
            const rect = footprint(part);
            const near = ([x, y]: Point) =>
              Math.hypot(
                Math.max(rect.minX - x, 0, x - rect.maxX),
                Math.max(rect.minY - y, 0, y - rect.maxY),
              );
            for (const pin of room.pins) {
              expect(near(pin), `${part.item} in ${room.name} on a pin`).toBeGreaterThan(0.5);
            }
            for (const door of room.doors) {
              expect(
                near(door.position),
                `${part.item} in ${room.name} in a doorway`,
              ).toBeGreaterThan(door.width / 2 + 0.5);
            }
          }
        }
      });

      it('lays a room out the same way every time', () => {
        for (const room of rooms) expect(furnishRoom(room)).toEqual(furnishRoom(room));
      });

      it('stands everything on the floor', () => {
        for (const room of rooms) {
          for (const part of furnishRoom(room)) {
            const height = part.shape === 'ring' ? part.size[0] : part.size[2];
            expect(part.elevation - height / 2, `${part.item} in ${room.name}`).toBeGreaterThan(
              -0.05,
            );
          }
        }
      });
    });
  }
});

describe('a room is furnished by what it is for', () => {
  const rooms = new Map(everyRoom(VENUES.campus).map((room) => [room.id, room]));
  const items = (id: string) => {
    const room = rooms.get(id);
    if (room === undefined) throw new Error(`no room ${id}`);
    return furnishRoom(room).map((part) => part.item);
  };
  const count = (id: string, item: string) =>
    // Each piece is several solids; a bed's frame is the one that is 0.95 wide.
    new Set(
      furnishRoom(rooms.get(id) as RoomToFurnish)
        .filter((part) => part.item === item)
        .map((part) => `${Math.round(part.position[0])},${Math.round(part.position[1])}`),
    ).size;

  it.each([
    ['l2-cardiac-ward', 'ward', 'bed'],
    ['l1-childrens', 'ward', 'bed'],
    ['e-treatment', 'ward', 'bed'],
    ['l2-dialysis', 'infusion', 'recliner'],
    ['g-pharmacy', 'retail', 'shelf'],
    ['g-shop', 'retail', 'shelf'],
    ['g-cafe', 'cafe', 'table'],
    ['g-imaging', 'imaging', 'scanner'],
    ['g-laboratory', 'laboratory', 'bench'],
    ['g-registration', 'front-desk', 'counter'],
    ['g-information', 'front-desk', 'counter'],
    ['e-triage', 'front-desk', 'counter'],
    ['l2-research', 'office', 'desk'],
    ['l2-education', 'classroom', 'screen'],
    ['e-waiting', 'lounge', 'sofa'],
    ['l2-sky-terrace', 'terrace', 'planter'],
    ['g-cardiology', 'clinic', 'consulting bay'],
    ['w-gym', 'gym', 'treadmill'],
    ['w-hydrotherapy', 'pool', 'pool'],
    ['w-studio', 'studio', 'mat'],
    ['g-lifts', 'lifts', 'lift'],
    ['g-stairs', 'stairs', 'stairs'],
    ['g-hall', 'lobby', 'counter'],
  ])('%s is a %s and has a %s in it', (id, use, item) => {
    expect(roomUse(rooms.get(id) as RoomToFurnish)).toBe(use);
    expect(items(id)).toContain(item);
  });

  it('gives a ward a row of beds, not one', () => {
    expect(count('l2-cardiac-ward', 'bed')).toBeGreaterThanOrEqual(4);
  });

  it('leaves no indoor room of the campus bare', () => {
    const outdoors = new Set([
      'car-park',
      'gate',
      'healing-garden',
      'promenade',
      'forecourt',
      'garden-path',
      'car-park-walk',
      'west-walk',
      'east-walk',
      'court-north',
      'court-south',
      'court-east',
      'court-west',
    ]);
    for (const room of rooms.values()) {
      if (outdoors.has(room.id) || room.type === 'corridor') continue;
      expect(furnishRoom(room).length, `${room.name} is empty`).toBeGreaterThan(0);
    }
  });

  it('reads the name before the category, and a whole word from its start', () => {
    const use = (name: string, purposes: string[] = [], type = 'room') =>
      roomUse({ name, type, purposes });
    expect(use('Courtyard Café')).toBe('cafe');
    expect(use('Clinical Research Office')).toBe('office');
    expect(use('Dialysis Unit', ['Dialysis Unit', 'medical'])).toBe('infusion');
    expect(use('Room 12', ['Room 12', 'pharmacy'])).toBe('retail');
    expect(use('Room 12')).toBe('plain');
    expect(use('Main Lift Lobby', [], 'vertical-circulation')).toBe('lifts');
    expect(use('North Stair Hall', [], 'vertical-circulation')).toBe('stairs');
    expect(use('East Corridor', ['Pharmacy'], 'corridor')).toBe('concourse');
  });
});
