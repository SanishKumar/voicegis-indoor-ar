import { describe, expect, it } from 'vitest';
import example from '../../packages/spatial-schema/examples/minimal-two-floor.json';
import asterionPackage from '../../buildings/asterion-medical-center/compiled/building.package.json';
import harborPackage from '../../buildings/harbor-exchange/compiled/building.package.json';
import { compileBuildingInBrowser } from '@voicegis/map-compiler/browser';
import {
  formatBuildingSource,
  sourceFromVenuePackage,
  validateBuildingSourceDraft,
} from './buildingSourceWorkspace';

describe('Venue Studio BuildingSource workspace', () => {
  it('accepts a schema-valid and semantically valid source', () => {
    const result = validateBuildingSourceDraft(JSON.stringify(example));

    expect(result.valid).toBe(true);
    expect(result.syntaxValid).toBe(true);
    expect(result.shapeValid).toBe(true);
    expect(result.stats).toMatchObject({ floors: 2, connectors: 1 });
    expect(result.issues).toEqual([]);
  });

  it('reports JSON syntax errors without entering schema validation', () => {
    const result = validateBuildingSourceDraft('{"schemaVersion":');

    expect(result.valid).toBe(false);
    expect(result.syntaxValid).toBe(false);
    expect(result.shapeValid).toBe(false);
    expect(result.issues[0]).toMatchObject({ stage: 'json', code: 'invalid-json', path: '/' });
  });

  it('reports schema errors before semantic validation', () => {
    const invalid = structuredClone(example) as Record<string, unknown>;
    delete invalid.floors;
    const result = validateBuildingSourceDraft(JSON.stringify(invalid));

    expect(result.valid).toBe(false);
    expect(result.syntaxValid).toBe(true);
    expect(result.shapeValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'schema', code: 'schema-required', path: '/floors' }),
      ]),
    );
  });

  it('reports deterministic compiler semantic issues', () => {
    const invalid = structuredClone(example);
    invalid.spaces[1].id = invalid.spaces[0].id;
    const result = validateBuildingSourceDraft(JSON.stringify(invalid));

    expect(result.valid).toBe(false);
    expect(result.shapeValid).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'semantic', code: 'duplicate-id' }),
      ]),
    );
  });

  it('derives an editable source without package-only fields', () => {
    const buildingPackage = {
      sourceSchemaVersion: example.schemaVersion,
      building: example.building,
      floors: example.floors,
      spaces: example.spaces,
      portals: example.portals,
      verticalConnectors: example.verticalConnectors,
      pois: example.pois,
      localizationAnchors: example.localizationAnchors,
      routing: { nodes: [], edges: [] },
      manifest: { hashAlgorithm: 'sha256', contentHash: 'test' },
    };

    const source = sourceFromVenuePackage(buildingPackage as never);
    const formatted = formatBuildingSource(source);

    expect(source.building.id).toBe(example.building.id);
    expect(source).not.toHaveProperty('routing');
    expect(source).not.toHaveProperty('manifest');
    expect(formatted.endsWith('\n')).toBe(true);
  });

  it.each([
    ['Asterion', asterionPackage],
    ['Harbor Exchange', harborPackage],
  ])('recompiles the active %s package to the exact same hash', async (_name, buildingPackage) => {
    const source = sourceFromVenuePackage(buildingPackage as never);
    const result = await compileBuildingInBrowser(source);

    expect(result.package?.manifest.contentHash).toBe(buildingPackage.manifest.contentHash);
  });
});
