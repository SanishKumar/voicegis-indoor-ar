import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { calculateTextSha256, utf8ByteLength } from '../data/contentDigest';
import { stablePackageJson } from '../data/packageLifecycle';
import { verifyVenuePackage } from '../data/venuePackageContract';
import {
  parseVenueVersionCatalog,
  type VenueCatalogRelease,
  type VenueVersionCatalog,
} from '../data/venueVersionCatalog';

export const REFERENCE_PUBLISH_PROTOCOL_VERSION = '0.1.0' as const;

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ReferencePublishAuthorizer = (request: Request) => boolean | Promise<boolean>;

export interface ReferencePublishServiceOptions {
  publicOrigin: string;
  catalogPath?: string;
  packagePathPrefix?: string;
  authorizeMutation?: ReferencePublishAuthorizer;
}

interface StoredPackage {
  artifactHash: string;
  buildingPackage: CompiledBuildingPackage;
  text: string;
}

function jsonError(status: number, message: string, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: responseHeaders,
  });
}

function strongEtag(digest: string) {
  return `"${digest}"`;
}

function normalizePath(value: string, label: string) {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    throw new Error(`${label} must be an absolute URL path.`);
  }
  return value;
}

function normalizePackagePrefix(value: string) {
  const path = normalizePath(value, 'Package path prefix');
  return path.endsWith('/') ? path : `${path}/`;
}

function normalizePublicOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Reference publishing public origin must be an absolute HTTPS origin.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('Reference publishing public origin must be an absolute HTTPS origin.');
  }
  return url.origin;
}

function parseStrongEtag(value: string | null) {
  if (!value) return null;
  return /^"([a-f0-9]{64})"$/.exec(value)?.[1] ?? null;
}

function releasePath(
  release: VenueCatalogRelease,
  publicOrigin: string,
  packagePathPrefix: string,
) {
  let url: URL;
  try {
    url = new URL(release.packageUrl);
  } catch {
    return null;
  }
  if (
    url.origin !== publicOrigin ||
    !url.pathname.startsWith(packagePathPrefix) ||
    url.pathname === packagePathPrefix ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.pathname;
}

function validateAppendOnlyTransition(
  current: VenueVersionCatalog,
  next: VenueVersionCatalog,
  packages: Map<string, StoredPackage>,
  publicOrigin: string,
  packagePathPrefix: string,
) {
  if (
    current.catalogVersion !== next.catalogVersion ||
    current.defaultVenueId !== next.defaultVenueId ||
    current.venues.length !== next.venues.length
  ) {
    return 'Publishing v0 cannot change catalog identity, defaults, or venue membership.';
  }

  let appendedReleaseCount = 0;
  for (const [venueIndex, currentVenue] of current.venues.entries()) {
    const nextVenue = next.venues[venueIndex];
    if (
      !nextVenue ||
      currentVenue.id !== nextVenue.id ||
      currentVenue.name !== nextVenue.name ||
      currentVenue.description !== nextVenue.description ||
      currentVenue.defaultReleaseId !== nextVenue.defaultReleaseId ||
      nextVenue.releases.length < currentVenue.releases.length
    ) {
      return 'Publishing v0 permits append-only release changes without promotion.';
    }

    for (const [releaseIndex, currentRelease] of currentVenue.releases.entries()) {
      if (
        stablePackageJson(currentRelease) !== stablePackageJson(nextVenue.releases[releaseIndex])
      ) {
        return 'Existing catalog releases are immutable.';
      }
    }

    for (const release of nextVenue.releases.slice(currentVenue.releases.length)) {
      appendedReleaseCount += 1;
      if (release.status === 'archived') {
        return 'New releases must use preview or stable status.';
      }
      const path = releasePath(release, publicOrigin, packagePathPrefix);
      const storedPackage = path ? packages.get(path) : null;
      if (!path || !storedPackage) {
        return 'Every appended release must reference a package stored by this service.';
      }
      if (storedPackage.buildingPackage.manifest.contentHash !== release.contentHash) {
        return 'Catalog release content hash does not match the stored VenuePackage.';
      }
      if (storedPackage.buildingPackage.building.id !== nextVenue.id) {
        return 'Catalog release venue does not match the stored VenuePackage.';
      }
    }
  }

  if (appendedReleaseCount !== 1) {
    return 'Publishing v0 catalog commits must append exactly one release.';
  }
  return null;
}

export class ReferencePublishService {
  private catalog: VenueVersionCatalog;
  private revision: string;
  private readonly publicOrigin: string;
  private readonly catalogPath: string;
  private readonly packagePathPrefix: string;
  private readonly authorizeMutation?: ReferencePublishAuthorizer;
  private readonly packages = new Map<string, StoredPackage>();
  private packageWrites = 0;
  private catalogWrites = 0;

  private constructor(
    catalog: VenueVersionCatalog,
    revision: string,
    options: ReferencePublishServiceOptions,
  ) {
    this.catalog = structuredClone(catalog);
    this.revision = revision;
    this.publicOrigin = normalizePublicOrigin(options.publicOrigin);
    this.catalogPath = normalizePath(options.catalogPath ?? '/catalog.json', 'Catalog path');
    this.packagePathPrefix = normalizePackagePrefix(options.packagePathPrefix ?? '/releases/');
    this.authorizeMutation = options.authorizeMutation;
  }

  static async create(catalog: VenueVersionCatalog, options: ReferencePublishServiceOptions) {
    const validated = parseVenueVersionCatalog(structuredClone(catalog));
    const revision = await calculateTextSha256(stablePackageJson(validated));
    return new ReferencePublishService(validated, revision, options);
  }

  private async mutationAuthorized(request: Request) {
    if (request.headers.get('x-voicegis-publish-protocol') !== REFERENCE_PUBLISH_PROTOCOL_VERSION) {
      return jsonError(400, 'Unsupported or missing publishing protocol version.');
    }
    if (!this.authorizeMutation) {
      return jsonError(403, 'Reference publishing mutations are disabled.');
    }
    try {
      if (!(await this.authorizeMutation(request))) {
        return jsonError(403, 'Publishing authorization was rejected.');
      }
    } catch {
      return jsonError(403, 'Publishing authorization failed closed.');
    }
    return null;
  }

  private catalogResponse() {
    return new Response(stablePackageJson(this.catalog), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        ETag: strongEtag(this.revision),
      },
    });
  }

  private packageResponse(storedPackage: StoredPackage) {
    return new Response(storedPackage.text, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'application/json',
        ETag: strongEtag(storedPackage.artifactHash),
      },
    });
  }

  private async putPackage(request: Request, path: string) {
    const authorizationError = await this.mutationAuthorized(request);
    if (authorizationError) return authorizationError;
    if (request.headers.get('if-none-match') !== '*') {
      return jsonError(428, 'Immutable package uploads require If-None-Match: *.');
    }

    const existing = this.packages.get(path);
    if (existing) {
      return jsonError(412, 'Immutable package path already exists.', {
        ETag: strongEtag(existing.artifactHash),
      });
    }

    const declaredHash = request.headers.get('x-voicegis-artifact-sha256');
    const declaredBytes = Number(request.headers.get('x-voicegis-artifact-bytes'));
    if (
      !declaredHash ||
      !SHA256_PATTERN.test(declaredHash) ||
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > MAX_PACKAGE_BYTES
    ) {
      return jsonError(400, 'Package digest or byte-length metadata is invalid.');
    }
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      return jsonError(415, 'VenuePackage uploads must use application/json.');
    }

    let text: string;
    try {
      text = await request.text();
    } catch {
      return jsonError(400, 'VenuePackage request body could not be read.');
    }
    if (utf8ByteLength(text) !== declaredBytes || declaredBytes > MAX_PACKAGE_BYTES) {
      return jsonError(400, 'VenuePackage byte length does not match its declaration.');
    }
    if ((await calculateTextSha256(text)) !== declaredHash) {
      return jsonError(400, 'VenuePackage artifact digest does not match its declaration.');
    }

    let buildingPackage: CompiledBuildingPackage;
    try {
      buildingPackage = await verifyVenuePackage(JSON.parse(text));
    } catch {
      return jsonError(422, 'VenuePackage verification failed.');
    }

    const racedPackage = this.packages.get(path);
    if (racedPackage) {
      return jsonError(412, 'Immutable package path already exists.', {
        ETag: strongEtag(racedPackage.artifactHash),
      });
    }
    this.packages.set(path, {
      artifactHash: declaredHash,
      buildingPackage: structuredClone(buildingPackage),
      text,
    });
    this.packageWrites += 1;
    return new Response(null, {
      status: 201,
      headers: {
        ETag: strongEtag(declaredHash),
        Location: `${this.publicOrigin}${path}`,
      },
    });
  }

  private async patchCatalog(request: Request) {
    const authorizationError = await this.mutationAuthorized(request);
    if (authorizationError) return authorizationError;
    const expectedRevision = parseStrongEtag(request.headers.get('if-match'));
    if (!expectedRevision) {
      return jsonError(428, 'Catalog commits require a strong If-Match revision.');
    }
    if (expectedRevision !== this.revision) {
      return jsonError(412, 'Catalog revision is stale.', {
        ETag: strongEtag(this.revision),
      });
    }
    const baseCatalog = structuredClone(this.catalog);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      return jsonError(415, 'Catalog commits must use application/json.');
    }

    let text: string;
    try {
      text = await request.text();
    } catch {
      return jsonError(400, 'Catalog request body could not be read.');
    }
    if (utf8ByteLength(text) > MAX_CATALOG_BYTES) {
      return jsonError(413, 'Catalog request body is too large.');
    }

    let nextCatalog: VenueVersionCatalog;
    try {
      nextCatalog = parseVenueVersionCatalog(JSON.parse(text));
    } catch {
      return jsonError(422, 'Catalog validation failed.');
    }
    const canonicalText = stablePackageJson(nextCatalog);
    if (text !== canonicalText) {
      return jsonError(400, 'Catalog commits must use canonical JSON.');
    }
    const nextRevision = await calculateTextSha256(canonicalText);
    if (request.headers.get('x-voicegis-catalog-revision') !== nextRevision) {
      return jsonError(400, 'Declared catalog revision does not match its canonical JSON.');
    }
    const transitionError = validateAppendOnlyTransition(
      baseCatalog,
      nextCatalog,
      this.packages,
      this.publicOrigin,
      this.packagePathPrefix,
    );
    if (transitionError) return jsonError(409, transitionError);
    if (expectedRevision !== this.revision) {
      return jsonError(412, 'Catalog revision changed during commit.', {
        ETag: strongEtag(this.revision),
      });
    }

    this.catalog = structuredClone(nextCatalog);
    this.revision = nextRevision;
    this.catalogWrites += 1;
    return this.catalogResponse();
  }

  async handle(request: Request) {
    const url = new URL(request.url);
    if (url.search || url.hash) {
      return jsonError(400, 'Reference publishing URLs cannot contain query or fragment.');
    }

    if (url.pathname === this.catalogPath) {
      if (request.method === 'GET') return this.catalogResponse();
      if (request.method === 'PATCH') return this.patchCatalog(request);
      return jsonError(405, 'Method not allowed.', { Allow: 'GET, PATCH' });
    }

    if (
      url.pathname.startsWith(this.packagePathPrefix) &&
      url.pathname !== this.packagePathPrefix
    ) {
      if (request.method === 'GET') {
        const storedPackage = this.packages.get(url.pathname);
        return storedPackage
          ? this.packageResponse(storedPackage)
          : jsonError(404, 'VenuePackage artifact was not found.');
      }
      if (request.method === 'PUT') return this.putPackage(request, url.pathname);
      return jsonError(405, 'Method not allowed.', { Allow: 'GET, PUT' });
    }

    return jsonError(404, 'Reference publishing route was not found.');
  }

  getStats() {
    return {
      catalogWrites: this.catalogWrites,
      packageWrites: this.packageWrites,
      revision: this.revision,
      storedPackages: this.packages.size,
    };
  }
}
