import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { stablePackageJson } from '../data/packageLifecycle';
import { calculateTextSha256, utf8ByteLength } from '../data/contentDigest';
import { verifyVenuePackage } from '../data/venuePackageContract';
import type {
  VenueCatalogRelease,
  VenueReleaseStatus,
  VenueVersionCatalog,
} from '../data/venueVersionCatalog';
import { createVenuePackageArtifact, type VenuePackageArtifact } from './venuePackageArtifact';

export const PUBLISH_DRY_RUN_VERSION = '0.1.0' as const;

export interface PublishDryRunOptions {
  packageBaseUrl: string;
  catalogUrl: string;
  status: Exclude<VenueReleaseStatus, 'archived'>;
  publishedAt: string;
  notes: string;
}

export interface PublishDryRunPlan {
  planVersion: typeof PUBLISH_DRY_RUN_VERSION;
  mode: 'dry-run';
  venue: {
    id: string;
    name: string;
  };
  artifact: {
    fileName: string;
    mediaType: string;
    byteLength: number;
    contentHash: string;
    artifactHash: string;
  };
  release: VenueCatalogRelease;
  catalogProposal: {
    catalogVersion: string;
    action: 'append-release' | 'no-op';
    venueId: string;
    currentDefaultReleaseId: string;
    nextDefaultReleaseId: string;
    expectedRevision: string;
  };
  operations: [
    {
      sequence: 1;
      type: 'package-upload';
      method: 'PUT';
      url: string;
      contentType: string;
      byteLength: number;
      sha256: string;
      execute: false;
    },
    {
      sequence: 2;
      type: 'catalog-release-upsert';
      method: 'PATCH';
      url: string;
      contentType: 'application/json';
      releaseId: string;
      execute: false;
    },
  ];
  safety: {
    networkRequests: 0;
    catalogWrites: 0;
    credentialsUsed: false;
    runtimeActivation: false;
  };
}

export interface PublishDryRunArtifact {
  fileName: string;
  mediaType: 'application/json';
  text: string;
  byteLength: number;
  planHash: string;
  plan: PublishDryRunPlan;
}

export class PublishDryRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishDryRunError';
  }
}

function safeHttpsUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublishDryRunError(`${label} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new PublishDryRunError(`${label} must use HTTPS.`);
  }
  if (url.username || url.password) {
    throw new PublishDryRunError(`${label} must not contain credentials.`);
  }
  if (url.search || url.hash) {
    throw new PublishDryRunError(`${label} must not contain a query or fragment.`);
  }
  return url;
}

function packageTargetUrl(baseUrl: string, fileName: string) {
  const base = safeHttpsUrl(baseUrl, 'Package base URL');
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  return new URL(encodeURIComponent(fileName), base).toString();
}

function canonicalTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new PublishDryRunError('Publication time must be a valid ISO-8601 timestamp.');
  }
  return timestamp.toISOString();
}

function assertArtifactMatches(supplied: VenuePackageArtifact, canonical: VenuePackageArtifact) {
  if (
    supplied.fileName !== canonical.fileName ||
    supplied.contentHash !== canonical.contentHash ||
    supplied.artifactHash !== canonical.artifactHash ||
    supplied.byteLength !== canonical.byteLength ||
    supplied.text !== canonical.text
  ) {
    throw new PublishDryRunError(
      'The staged package artifact does not match the verified compiler output.',
    );
  }
}

export async function createPublishDryRun(
  candidatePackage: CompiledBuildingPackage,
  artifact: VenuePackageArtifact,
  catalog: VenueVersionCatalog,
  options: PublishDryRunOptions,
): Promise<PublishDryRunArtifact> {
  const buildingPackage = await verifyVenuePackage(candidatePackage);
  const canonicalArtifact = await createVenuePackageArtifact(buildingPackage);
  assertArtifactMatches(artifact, canonicalArtifact);

  const venue = catalog.venues.find((candidate) => candidate.id === buildingPackage.building.id);
  if (!venue) {
    throw new PublishDryRunError(
      `Venue "${buildingPackage.building.id}" is not in the catalog. Creating new catalog venues is outside Publishing v0.`,
    );
  }

  const notes = options.notes.trim();
  if (!notes) throw new PublishDryRunError('Release notes are required.');
  if (notes.length > 500) {
    throw new PublishDryRunError('Release notes must not exceed 500 characters.');
  }
  if (!['preview', 'stable'].includes(options.status)) {
    throw new PublishDryRunError('New releases must use preview or stable status.');
  }

  const packageUrl = packageTargetUrl(options.packageBaseUrl, artifact.fileName);
  const catalogUrl = safeHttpsUrl(options.catalogUrl, 'Catalog URL').toString();
  const publishedAt = canonicalTimestamp(options.publishedAt);
  const releaseId = `${buildingPackage.packageVersion}+${artifact.contentHash.slice(0, 12)}`;
  const release: VenueCatalogRelease = {
    releaseId,
    status: options.status,
    publishedAt,
    packageVersion: buildingPackage.packageVersion,
    compilerVersion: buildingPackage.compilerVersion,
    sourceSchemaVersion: buildingPackage.sourceSchemaVersion,
    contentHash: artifact.contentHash,
    packageUrl,
    notes,
    summary: {
      floors: buildingPackage.floors.length,
      spaces: buildingPackage.spaces.length,
      portals: buildingPackage.portals.length,
      connectors: buildingPackage.verticalConnectors.length,
      pois: buildingPackage.pois.length,
      anchors: buildingPackage.localizationAnchors.length,
    },
  };
  const catalogHasRelease = venue.releases.some(
    (candidate) => candidate.contentHash === release.contentHash,
  );
  const expectedRevision = await calculateTextSha256(stablePackageJson(catalog));
  const plan: PublishDryRunPlan = {
    planVersion: PUBLISH_DRY_RUN_VERSION,
    mode: 'dry-run',
    venue: {
      id: buildingPackage.building.id,
      name: buildingPackage.building.name,
    },
    artifact: {
      fileName: artifact.fileName,
      mediaType: artifact.mediaType,
      byteLength: artifact.byteLength,
      contentHash: artifact.contentHash,
      artifactHash: artifact.artifactHash,
    },
    release,
    catalogProposal: {
      catalogVersion: catalog.catalogVersion,
      action: catalogHasRelease ? 'no-op' : 'append-release',
      venueId: venue.id,
      currentDefaultReleaseId: venue.defaultReleaseId,
      nextDefaultReleaseId: venue.defaultReleaseId,
      expectedRevision,
    },
    operations: [
      {
        sequence: 1,
        type: 'package-upload',
        method: 'PUT',
        url: packageUrl,
        contentType: artifact.mediaType,
        byteLength: artifact.byteLength,
        sha256: artifact.artifactHash,
        execute: false,
      },
      {
        sequence: 2,
        type: 'catalog-release-upsert',
        method: 'PATCH',
        url: catalogUrl,
        contentType: 'application/json',
        releaseId,
        execute: false,
      },
    ],
    safety: {
      networkRequests: 0,
      catalogWrites: 0,
      credentialsUsed: false,
      runtimeActivation: false,
    },
  };
  const text = stablePackageJson(plan);
  return {
    fileName: `${buildingPackage.building.id}.${artifact.contentHash.slice(0, 12)}.publish-dry-run.json`,
    mediaType: 'application/json',
    text,
    byteLength: utf8ByteLength(text),
    planHash: await calculateTextSha256(text),
    plan,
  };
}
