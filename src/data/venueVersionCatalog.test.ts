import { describe, expect, it } from 'vitest';
import catalogJson from '../../public/venues/catalog.json';
import asterionPackage from '../../public/venues/asterion-medical-center.package.json';
import harborPackage from '../../public/venues/harbor-exchange.package.json';
import {
  VenueCatalogValidationError,
  createRuntimeCatalogEntries,
  parseVenueVersionCatalog,
} from './venueVersionCatalog';

describe('Venue version catalog contract', () => {
  it('accepts the bundled content-addressed release catalog', () => {
    const catalog = parseVenueVersionCatalog(catalogJson);
    const runtimeEntries = createRuntimeCatalogEntries(catalog);

    expect(runtimeEntries).toHaveLength(2);
    expect(runtimeEntries[0].packageUrl).toBe('/venues/asterion-medical-center.package.json');
    expect(runtimeEntries[0].defaultRelease.contentHash).toBe(asterionPackage.manifest.contentHash);
  });

  it.each([
    ['asterion-medical-center', asterionPackage],
    ['harbor-exchange', harborPackage],
  ])('keeps the %s catalog release synchronized with its package', (venueId, buildingPackage) => {
    const catalog = parseVenueVersionCatalog(catalogJson);
    const venue = catalog.venues.find((candidate) => candidate.id === venueId)!;
    const release = venue.releases.find(
      (candidate) => candidate.releaseId === venue.defaultReleaseId,
    )!;

    expect(release).toMatchObject({
      packageVersion: buildingPackage.packageVersion,
      compilerVersion: buildingPackage.compilerVersion,
      sourceSchemaVersion: buildingPackage.sourceSchemaVersion,
      contentHash: buildingPackage.manifest.contentHash,
      summary: {
        floors: buildingPackage.floors.length,
        spaces: buildingPackage.spaces.length,
        portals: buildingPackage.portals.length,
        connectors: buildingPackage.verticalConnectors.length,
        pois: buildingPackage.pois.length,
        anchors: buildingPackage.localizationAnchors.length,
      },
    });
  });

  it('rejects an unsupported catalog version', () => {
    const invalid = structuredClone(catalogJson);
    invalid.catalogVersion = '99.0.0';

    expect(() => parseVenueVersionCatalog(invalid)).toThrow(VenueCatalogValidationError);
  });

  it('rejects duplicate releases and missing default references', () => {
    const invalid = structuredClone(catalogJson);
    invalid.venues[0].defaultReleaseId = 'missing-release';
    invalid.venues[0].releases.push(structuredClone(invalid.venues[0].releases[0]));

    expect(() => parseVenueVersionCatalog(invalid)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.stringContaining('releaseId must be unique'),
          expect.stringContaining('defaultReleaseId must reference'),
        ]),
      }),
    );
  });

  it('rejects release metadata with an invalid content hash', () => {
    const invalid = structuredClone(catalogJson);
    invalid.venues[1].releases[0].contentHash = 'not-a-sha256-hash';

    expect(() => parseVenueVersionCatalog(invalid)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.stringContaining('must be a lowercase SHA-256 hash'),
        ]),
      }),
    );
  });
});
