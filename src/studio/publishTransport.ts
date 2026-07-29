import { calculateTextSha256, utf8ByteLength } from '../data/contentDigest';
import { stablePackageJson } from '../data/packageLifecycle';
import { verifyVenuePackage } from '../data/venuePackageContract';
import { parseVenueVersionCatalog, type VenueVersionCatalog } from '../data/venueVersionCatalog';
import type { PublishDryRunArtifact } from './publishDryRun';
import type { VenuePackageArtifact } from './venuePackageArtifact';

export interface PublishCatalogSnapshot {
  catalog: VenueVersionCatalog;
  revision: string;
}

export interface PublishPackageRequest {
  url: string;
  mediaType: string;
  text: string;
  byteLength: number;
  artifactHash: string;
}

export interface PublishPackageResult {
  created: boolean;
  artifactHash: string;
}

export interface PublishTransport {
  readonly kind: string;
  readonly simulated: boolean;
  readonly credentialsUsed: boolean;
  readCatalog(url: string): Promise<PublishCatalogSnapshot>;
  putPackage(request: PublishPackageRequest): Promise<PublishPackageResult>;
  compareAndSwapCatalog(
    url: string,
    expectedRevision: string,
    catalog: VenueVersionCatalog,
  ): Promise<PublishCatalogSnapshot>;
}

export interface PublishExecutionReceipt {
  receiptVersion: '0.1.0';
  planHash: string;
  transport: {
    kind: string;
    simulated: boolean;
    credentialsUsed: boolean;
  };
  status: 'published' | 'already-published';
  package: {
    url: string;
    artifactHash: string;
    created: boolean;
  };
  catalog: {
    url: string;
    changed: boolean;
    previousRevision: string;
    nextRevision: string;
    defaultReleaseChanged: false;
  };
  visibility: 'catalog-committed' | 'already-cataloged';
}

export class PublishTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishTransportError';
  }
}

export class PublishConflictError extends PublishTransportError {
  readonly expectedRevision: string;
  readonly actualRevision: string;
  readonly stage: 'preflight' | 'catalog-commit';
  readonly packageStored: boolean;

  constructor(options: {
    expectedRevision: string;
    actualRevision: string;
    stage: 'preflight' | 'catalog-commit';
    packageStored: boolean;
  }) {
    super(`Catalog revision conflict during ${options.stage}.`);
    this.name = 'PublishConflictError';
    this.expectedRevision = options.expectedRevision;
    this.actualRevision = options.actualRevision;
    this.stage = options.stage;
    this.packageStored = options.packageStored;
  }
}

export class InMemoryPublishTransport implements PublishTransport {
  readonly kind = 'memory-simulator';
  readonly simulated = true;
  readonly credentialsUsed = false;
  private catalog: VenueVersionCatalog;
  private revision: string;
  private readonly packages = new Map<string, PublishPackageRequest>();
  private packageWrites = 0;
  private catalogWrites = 0;

  private constructor(catalog: VenueVersionCatalog, revision: string) {
    this.catalog = structuredClone(catalog);
    this.revision = revision;
  }

  static async create(catalog: VenueVersionCatalog) {
    const revision = await calculateTextSha256(stablePackageJson(catalog));
    return new InMemoryPublishTransport(catalog, revision);
  }

  async readCatalog(_url: string): Promise<PublishCatalogSnapshot> {
    return {
      catalog: structuredClone(this.catalog),
      revision: this.revision,
    };
  }

  async putPackage(request: PublishPackageRequest): Promise<PublishPackageResult> {
    const actualHash = await calculateTextSha256(request.text);
    if (
      actualHash !== request.artifactHash ||
      utf8ByteLength(request.text) !== request.byteLength
    ) {
      throw new PublishTransportError('Package bytes do not match the declared artifact digest.');
    }
    const existing = this.packages.get(request.url);
    if (existing) {
      if (existing.artifactHash !== request.artifactHash) {
        throw new PublishTransportError(
          'Immutable package URL already contains different content.',
        );
      }
      return { created: false, artifactHash: existing.artifactHash };
    }
    this.packages.set(request.url, structuredClone(request));
    this.packageWrites += 1;
    return { created: true, artifactHash: request.artifactHash };
  }

  async compareAndSwapCatalog(
    _url: string,
    expectedRevision: string,
    catalog: VenueVersionCatalog,
  ): Promise<PublishCatalogSnapshot> {
    if (expectedRevision !== this.revision) {
      throw new PublishConflictError({
        expectedRevision,
        actualRevision: this.revision,
        stage: 'catalog-commit',
        packageStored: true,
      });
    }
    const validated = parseVenueVersionCatalog(structuredClone(catalog));
    const nextRevision = await calculateTextSha256(stablePackageJson(validated));
    if (expectedRevision !== this.revision) {
      throw new PublishConflictError({
        expectedRevision,
        actualRevision: this.revision,
        stage: 'catalog-commit',
        packageStored: true,
      });
    }
    this.catalog = structuredClone(validated);
    this.revision = nextRevision;
    this.catalogWrites += 1;
    return { catalog: structuredClone(this.catalog), revision: nextRevision };
  }

  async simulateConcurrentCatalogUpdate() {
    this.revision = await calculateTextSha256(`${this.revision}:concurrent-update`);
  }

  getStats() {
    return {
      packageWrites: this.packageWrites,
      catalogWrites: this.catalogWrites,
      storedPackages: this.packages.size,
      revision: this.revision,
    };
  }
}

async function verifyPlanAndArtifact(
  dryRun: PublishDryRunArtifact,
  artifact: VenuePackageArtifact,
) {
  const canonicalPlanText = stablePackageJson(dryRun.plan);
  if (
    canonicalPlanText !== dryRun.text ||
    (await calculateTextSha256(dryRun.text)) !== dryRun.planHash
  ) {
    throw new PublishTransportError('Publish plan receipt verification failed.');
  }
  if (
    artifact.fileName !== dryRun.plan.artifact.fileName ||
    artifact.contentHash !== dryRun.plan.artifact.contentHash ||
    artifact.artifactHash !== dryRun.plan.artifact.artifactHash ||
    artifact.byteLength !== dryRun.plan.artifact.byteLength ||
    (await calculateTextSha256(artifact.text)) !== artifact.artifactHash
  ) {
    throw new PublishTransportError('VenuePackage artifact does not match the publish plan.');
  }
  const packageValue = await verifyVenuePackage(JSON.parse(artifact.text));
  if (packageValue.manifest.contentHash !== dryRun.plan.release.contentHash) {
    throw new PublishTransportError('VenuePackage content hash does not match the release.');
  }
}

export async function executePublishPlan(
  dryRun: PublishDryRunArtifact,
  artifact: VenuePackageArtifact,
  transport: PublishTransport,
): Promise<PublishExecutionReceipt> {
  await verifyPlanAndArtifact(dryRun, artifact);
  const packageOperation = dryRun.plan.operations[0];
  const catalogOperation = dryRun.plan.operations[1];
  const expectedRevision = dryRun.plan.catalogProposal.expectedRevision;
  const before = await transport.readCatalog(catalogOperation.url);
  if (before.revision !== expectedRevision) {
    throw new PublishConflictError({
      expectedRevision,
      actualRevision: before.revision,
      stage: 'preflight',
      packageStored: false,
    });
  }

  const packageResult = await transport.putPackage({
    url: packageOperation.url,
    mediaType: packageOperation.contentType,
    text: artifact.text,
    byteLength: artifact.byteLength,
    artifactHash: artifact.artifactHash,
  });

  if (dryRun.plan.catalogProposal.action === 'no-op') {
    const cataloged = before.catalog.venues.some((venue) =>
      venue.releases.some((release) => release.contentHash === dryRun.plan.release.contentHash),
    );
    if (!cataloged) {
      throw new PublishTransportError(
        'The plan declared a catalog no-op, but the release is not cataloged.',
      );
    }
    return {
      receiptVersion: '0.1.0',
      planHash: dryRun.planHash,
      transport: {
        kind: transport.kind,
        simulated: transport.simulated,
        credentialsUsed: transport.credentialsUsed,
      },
      status: 'already-published',
      package: {
        url: packageOperation.url,
        artifactHash: artifact.artifactHash,
        created: packageResult.created,
      },
      catalog: {
        url: catalogOperation.url,
        changed: false,
        previousRevision: before.revision,
        nextRevision: before.revision,
        defaultReleaseChanged: false,
      },
      visibility: 'already-cataloged',
    };
  }

  const nextCatalog = structuredClone(before.catalog);
  const venue = nextCatalog.venues.find(
    (candidate) => candidate.id === dryRun.plan.catalogProposal.venueId,
  );
  if (!venue) throw new PublishTransportError('Publish venue disappeared from the catalog.');
  if (venue.defaultReleaseId !== dryRun.plan.catalogProposal.currentDefaultReleaseId) {
    throw new PublishConflictError({
      expectedRevision,
      actualRevision: before.revision,
      stage: 'preflight',
      packageStored: packageResult.created,
    });
  }
  if (venue.releases.some((release) => release.releaseId === dryRun.plan.release.releaseId)) {
    throw new PublishTransportError('Release identifier already exists with another plan.');
  }
  venue.releases.push(structuredClone(dryRun.plan.release));
  const committed = await transport.compareAndSwapCatalog(
    catalogOperation.url,
    expectedRevision,
    parseVenueVersionCatalog(nextCatalog),
  );

  return {
    receiptVersion: '0.1.0',
    planHash: dryRun.planHash,
    transport: {
      kind: transport.kind,
      simulated: transport.simulated,
      credentialsUsed: transport.credentialsUsed,
    },
    status: 'published',
    package: {
      url: packageOperation.url,
      artifactHash: artifact.artifactHash,
      created: packageResult.created,
    },
    catalog: {
      url: catalogOperation.url,
      changed: true,
      previousRevision: before.revision,
      nextRevision: committed.revision,
      defaultReleaseChanged: false,
    },
    visibility: 'catalog-committed',
  };
}
