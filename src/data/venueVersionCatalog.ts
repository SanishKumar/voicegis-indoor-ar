export const VENUE_VERSION_CATALOG_VERSION = '0.2.0' as const;

export type VenueReleaseStatus = 'stable' | 'preview' | 'archived';

export interface VenueReleaseSummary {
  floors: number;
  spaces: number;
  portals: number;
  connectors: number;
  pois: number;
  anchors: number;
}

export interface VenueCatalogRelease {
  releaseId: string;
  status: VenueReleaseStatus;
  publishedAt: string;
  packageVersion: string;
  compilerVersion: string;
  sourceSchemaVersion: string;
  contentHash: string;
  packageUrl: string;
  notes: string;
  summary: VenueReleaseSummary;
}

export interface VenueCatalogEntry {
  id: string;
  name: string;
  description: string;
  defaultReleaseId: string;
  releases: VenueCatalogRelease[];
}

export interface VenueVersionCatalog {
  catalogVersion: typeof VENUE_VERSION_CATALOG_VERSION;
  defaultVenueId: string;
  venues: VenueCatalogEntry[];
}

export interface RuntimeCatalogEntry extends VenueCatalogEntry {
  packageUrl: string;
  defaultRelease: VenueCatalogRelease;
}

export class VenueCatalogValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Venue version catalog validation failed with ${issues.length} issue(s).`);
    this.name = 'VenueCatalogValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string, path: string, issues: string[]) {
  if (typeof record[key] !== 'string' || record[key].length === 0) {
    issues.push(`${path}/${key} must be a non-empty string.`);
    return false;
  }
  return true;
}

function validateSummary(value: unknown, path: string, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  for (const key of ['floors', 'spaces', 'portals', 'connectors', 'pois', 'anchors']) {
    const count = value[key];
    if (!Number.isInteger(count) || Number(count) < 0) {
      issues.push(`${path}/${key} must be a non-negative integer.`);
    }
  }
}

function validateRelease(value: unknown, path: string, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  for (const key of [
    'releaseId',
    'status',
    'publishedAt',
    'packageVersion',
    'compilerVersion',
    'sourceSchemaVersion',
    'contentHash',
    'packageUrl',
    'notes',
  ]) {
    hasString(value, key, path, issues);
  }
  if (
    typeof value.status === 'string' &&
    !['stable', 'preview', 'archived'].includes(value.status)
  ) {
    issues.push(`${path}/status must be stable, preview, or archived.`);
  }
  if (typeof value.publishedAt === 'string' && Number.isNaN(Date.parse(value.publishedAt))) {
    issues.push(`${path}/publishedAt must be an ISO-8601 timestamp.`);
  }
  if (typeof value.contentHash === 'string' && !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    issues.push(`${path}/contentHash must be a lowercase SHA-256 hash.`);
  }
  validateSummary(value.summary, `${path}/summary`, issues);
}

export function parseVenueVersionCatalog(value: unknown): VenueVersionCatalog {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new VenueCatalogValidationError(['/ must be an object.']);
  }
  if (value.catalogVersion !== VENUE_VERSION_CATALOG_VERSION) {
    issues.push(`/catalogVersion must equal supported version ${VENUE_VERSION_CATALOG_VERSION}.`);
  }
  hasString(value, 'defaultVenueId', '', issues);
  if (!Array.isArray(value.venues) || value.venues.length === 0) {
    issues.push('/venues must be a non-empty array.');
  }

  const venueIds = new Set<string>();
  const packageHashes = new Set<string>();
  const packageUrls = new Set<string>();
  for (const [venueIndex, candidate] of (Array.isArray(value.venues)
    ? value.venues
    : []
  ).entries()) {
    const path = `/venues/${venueIndex}`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object.`);
      continue;
    }
    for (const key of ['id', 'name', 'description', 'defaultReleaseId']) {
      hasString(candidate, key, path, issues);
    }
    if (typeof candidate.id === 'string') {
      if (venueIds.has(candidate.id)) issues.push(`${path}/id must be unique.`);
      venueIds.add(candidate.id);
    }
    if (!Array.isArray(candidate.releases) || candidate.releases.length === 0) {
      issues.push(`${path}/releases must be a non-empty array.`);
      continue;
    }

    const releaseIds = new Set<string>();
    for (const [releaseIndex, release] of candidate.releases.entries()) {
      const releasePath = `${path}/releases/${releaseIndex}`;
      validateRelease(release, releasePath, issues);
      if (!isRecord(release)) continue;
      if (typeof release.releaseId === 'string') {
        if (releaseIds.has(release.releaseId)) {
          issues.push(`${releasePath}/releaseId must be unique within the venue.`);
        }
        releaseIds.add(release.releaseId);
      }
      if (typeof release.contentHash === 'string') {
        if (packageHashes.has(release.contentHash)) {
          issues.push(`${releasePath}/contentHash must be unique across the catalog.`);
        }
        packageHashes.add(release.contentHash);
      }
      if (typeof release.packageUrl === 'string') {
        if (packageUrls.has(release.packageUrl)) {
          issues.push(`${releasePath}/packageUrl must be unique across the catalog.`);
        }
        packageUrls.add(release.packageUrl);
      }
    }
    if (
      typeof candidate.defaultReleaseId === 'string' &&
      !releaseIds.has(candidate.defaultReleaseId)
    ) {
      issues.push(`${path}/defaultReleaseId must reference a release in this venue.`);
    }
  }

  if (typeof value.defaultVenueId === 'string' && !venueIds.has(value.defaultVenueId)) {
    issues.push('/defaultVenueId must reference a venue in the catalog.');
  }
  if (issues.length > 0) throw new VenueCatalogValidationError(issues);
  return value as unknown as VenueVersionCatalog;
}

export function createRuntimeCatalogEntries(catalog: VenueVersionCatalog): RuntimeCatalogEntry[] {
  return catalog.venues.map((venue) => {
    const defaultRelease = venue.releases.find(
      (release) => release.releaseId === venue.defaultReleaseId,
    )!;
    return {
      ...venue,
      defaultRelease,
      packageUrl: defaultRelease.packageUrl,
    };
  });
}
