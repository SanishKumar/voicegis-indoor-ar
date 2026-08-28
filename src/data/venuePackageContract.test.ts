import { describe, expect, it } from 'vitest';
import { ASTERION_PACKAGE, HARBOR_PACKAGE } from '../test/venueFixtures';
import {
  VenuePackageVerificationError,
  loadVenuePackageFromUrl,
  verifyVenuePackage,
} from './venuePackageContract';

describe('VenuePackage runtime contract', () => {
  it('accepts unrelated compiler artifacts with reproducible hashes', async () => {
    await expect(verifyVenuePackage(ASTERION_PACKAGE)).resolves.toBe(ASTERION_PACKAGE);
    await expect(verifyVenuePackage(HARBOR_PACKAGE)).resolves.toBe(HARBOR_PACKAGE);
  });

  it('loads a package from a URL response rather than a source import', async () => {
    const fetchPackage = async () =>
      new Response(JSON.stringify(HARBOR_PACKAGE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const loaded = await loadVenuePackageFromUrl(
      'https://venues.example/harbor.package.json',
      fetchPackage as typeof fetch,
    );
    expect(loaded.building.id).toBe('harbor-exchange');
    expect(loaded.manifest.contentHash).toBe(HARBOR_PACKAGE.manifest.contentHash);
  });

  it('binds a catalog-selected URL to both its venue and full content hash', async () => {
    const fetchPackage = async () =>
      new Response(JSON.stringify(HARBOR_PACKAGE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await expect(
      loadVenuePackageFromUrl(
        '/venues/asterion-medical-center.package.json',
        fetchPackage as typeof fetch,
        {
          buildingId: ASTERION_PACKAGE.building.id,
          contentHash: ASTERION_PACKAGE.manifest.contentHash,
        },
      ),
    ).rejects.toMatchObject({
      name: 'VenuePackageVerificationError',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'catalog-building-mismatch' }),
        expect.objectContaining({ code: 'catalog-content-hash-mismatch' }),
      ]),
    });
  });

  it('refuses a self-consistent package that is not the catalogued release hash', async () => {
    const fetchPackage = async () =>
      new Response(JSON.stringify(ASTERION_PACKAGE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await expect(
      loadVenuePackageFromUrl(
        '/venues/asterion-medical-center.package.json',
        fetchPackage as typeof fetch,
        {
          buildingId: ASTERION_PACKAGE.building.id,
          contentHash: 'b'.repeat(64),
        },
      ),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'catalog-content-hash-mismatch' })],
    });
  });

  it('rejects tampering before runtime activation', async () => {
    const tampered = structuredClone(HARBOR_PACKAGE);
    tampered.building.name = 'Tampered Harbor';

    await expect(verifyVenuePackage(tampered)).rejects.toMatchObject({
      name: 'VenuePackageVerificationError',
      issues: [expect.objectContaining({ code: 'content-hash-mismatch' })],
    });
  });

  it('requires explicit accessibility policy on every compiled edge', async () => {
    const unsafe = structuredClone(HARBOR_PACKAGE) as unknown as Record<string, unknown>;
    const routing = unsafe.routing as { edges: Record<string, unknown>[] };
    delete routing.edges[0].accessible;

    await expect(verifyVenuePackage(unsafe)).rejects.toBeInstanceOf(VenuePackageVerificationError);
    await expect(verifyVenuePackage(unsafe)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'required-boolean' })],
    });
  });
});
