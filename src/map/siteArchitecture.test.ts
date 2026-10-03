import { describe, expect, it, vi } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import campusJson from '../../buildings/meridian-park-campus/compiled/building.package.json';
import { createSiteArchitecture, siteBuildingHeight } from './siteArchitecture';

const campus = campusJson as unknown as CompiledBuildingPackage;
const toWorld = ([x, y]: readonly [number, number], height = 0) => new Vector3(x, height, y);
const hospital = campus.site!.buildings.find((building) => building.id === 'main-hospital')!;

describe('authored campus architecture', () => {
  it('places a portico at the real entrance, projecting out rather than into the hospital', () => {
    const architecture = createSiteArchitecture(hospital, campus.portals, toWorld);
    const canopy = architecture.group.getObjectByName('entrance-canopy') as InstancedMesh;
    const glazing = architecture.group.getObjectByName('entrance-glazing') as InstancedMesh;
    expect(canopy.count).toBe(1);
    const matrix = new Matrix4();
    const position = new Vector3();
    canopy.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(105);
    expect(position.z).toBeGreaterThan(46);
    glazing.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(105);
    expect(position.z).toBeCloseTo(46.18);
    architecture.dispose();
  });

  it('puts the wing entrances on their facing edges and shares one envelope lifecycle', () => {
    for (const [id, expectedX, expectedZ] of [
      ['emergency-centre', 50.18, 84],
      ['wellness-pavilion', 159.82, 84],
    ] as const) {
      const building = campus.site!.buildings.find((entry) => entry.id === id)!;
      const architecture = createSiteArchitecture(building, campus.portals, toWorld);
      const glazing = architecture.group.getObjectByName('entrance-glazing') as InstancedMesh;
      const matrix = new Matrix4();
      glazing.getMatrixAt(0, matrix);
      const position = new Vector3().setFromMatrixPosition(matrix);
      expect(position.x).toBeCloseTo(expectedX);
      expect(position.z).toBeCloseTo(expectedZ);
      expect(architecture.group.children.every((part) => part.userData.siteBuildingId === id)).toBe(
        true,
      );
      architecture.dispose();
    }
  });

  it('has three authored storeys of instanced glazing, not hundreds of separate draw calls', () => {
    const architecture = createSiteArchitecture(hospital, campus.portals, toWorld);
    const windows = architecture.group.getObjectByName('facade-windows') as InstancedMesh;
    expect(windows.count).toBeGreaterThan(150);
    expect(architecture.group.children.length).toBeLessThan(15);
    const matrix = new Matrix4();
    const levels = new Set<number>();
    for (let index = 0; index < windows.count; index++) {
      windows.getMatrixAt(index, matrix);
      levels.add(Number(new Vector3().setFromMatrixPosition(matrix).y.toFixed(2)));
    }
    expect([...levels].sort((a, b) => a - b)).toEqual([2.15, 6.35, 10.55]);
    expect(new Box3().setFromObject(architecture.group).max.y).toBeGreaterThan(
      siteBuildingHeight(3),
    );
    architecture.dispose();
  });

  it('keeps a canopy outside a concave courtyard regardless of polygon winding', () => {
    const footprint: [number, number][] = [
      [0, 0],
      [50, 0],
      [50, 10],
      [10, 10],
      [10, 50],
      [0, 50],
    ];
    const portal = {
      ...campus.portals[0],
      id: 'courtyard-door',
      position: [25, 10] as [number, number],
      width: 2,
    };
    for (const points of [footprint, [...footprint].reverse()]) {
      const architecture = createSiteArchitecture(
        { ...hospital, footprint: points },
        [portal],
        toWorld,
      );
      const canopy = architecture.group.getObjectByName('entrance-canopy') as InstancedMesh;
      const matrix = new Matrix4();
      canopy.getMatrixAt(0, matrix);
      expect(new Vector3().setFromMatrixPosition(matrix).z).toBeGreaterThan(10);
      architecture.dispose();
    }
  });

  it('releases unique geometry, materials and per-instance GPU buffers once', () => {
    const architecture = createSiteArchitecture(hospital, campus.portals, toWorld);
    const parts = architecture.group.children as Mesh[];
    const geometries = [...new Set(parts.map((part) => part.geometry))];
    const geometrySpies = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialSpies = architecture.materials.map((material) => vi.spyOn(material, 'dispose'));
    const instanceSpies = parts
      .filter((part) => part instanceof InstancedMesh)
      .map((part) => vi.spyOn(part as InstancedMesh, 'dispose'));
    architecture.dispose();
    for (const spy of [...geometrySpies, ...materialSpies, ...instanceSpies])
      expect(spy).toHaveBeenCalledOnce();
  });
});
