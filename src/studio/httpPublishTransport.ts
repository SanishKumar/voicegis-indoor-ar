import { calculateTextSha256, utf8ByteLength } from '../data/contentDigest';
import { stablePackageJson } from '../data/packageLifecycle';
import { parseVenueVersionCatalog, type VenueVersionCatalog } from '../data/venueVersionCatalog';
import {
  PublishConflictError,
  PublishTransportError,
  type PublishCatalogSnapshot,
  type PublishPackageRequest,
  type PublishPackageResult,
  type PublishTransport,
} from './publishTransport';

export type HttpPublishPurpose = 'catalog-read' | 'package-upload' | 'catalog-commit';

export interface HttpPublishAuthorizationContext {
  method: 'GET' | 'PUT' | 'PATCH';
  purpose: HttpPublishPurpose;
  url: string;
}

export type HttpPublishAuthorizationProvider = (
  context: HttpPublishAuthorizationContext,
) => HeadersInit | Promise<HeadersInit>;

export type HttpPublishRequest = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpPublishTransportOptions {
  request: HttpPublishRequest;
  authorization?: HttpPublishAuthorizationProvider;
}

const MANAGED_HEADERS = new Set([
  'accept',
  'content-type',
  'if-match',
  'if-none-match',
  'x-voicegis-artifact-bytes',
  'x-voicegis-artifact-sha256',
  'x-voicegis-catalog-revision',
  'x-voicegis-publish-protocol',
]);

function requireHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublishTransportError('HTTP publishing targets must be absolute HTTPS URLs.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new PublishTransportError(
      'HTTP publishing targets must use HTTPS without credentials, query, or fragment.',
    );
  }
  return url.toString();
}

function requireDigest(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new PublishTransportError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function optionalStrongDigestEtag(response: Response) {
  const etag = response.headers.get('etag');
  if (!etag) return null;
  const match = /^"([a-f0-9]{64})"$/.exec(etag);
  return match?.[1] ?? null;
}

function requireStrongDigestEtag(response: Response, label: string) {
  const revision = optionalStrongDigestEtag(response);
  if (!revision) {
    throw new PublishTransportError(
      `${label} must return a strong ETag containing a lowercase SHA-256 digest.`,
    );
  }
  return revision;
}

function responseError(method: string, response: Response) {
  return new PublishTransportError(`HTTP ${method} failed with status ${response.status}.`);
}

function parseCatalogText(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PublishTransportError('Catalog response is not valid JSON.');
  }
  try {
    return parseVenueVersionCatalog(value);
  } catch {
    throw new PublishTransportError('Catalog response failed version-catalog validation.');
  }
}

export class HttpPublishTransport implements PublishTransport {
  readonly kind = 'http';
  readonly simulated = false;
  readonly credentialsUsed: boolean;
  private readonly request: HttpPublishRequest;
  private readonly authorization?: HttpPublishAuthorizationProvider;

  constructor(options: HttpPublishTransportOptions) {
    if (typeof options.request !== 'function') {
      throw new PublishTransportError('HTTP publishing requires an injected request function.');
    }
    this.request = options.request;
    this.authorization = options.authorization;
    this.credentialsUsed = Boolean(options.authorization);
  }

  private async requestHeaders(context: HttpPublishAuthorizationContext, managed: HeadersInit) {
    const headers = new Headers();
    if (this.authorization) {
      let supplied: HeadersInit;
      try {
        supplied = await this.authorization(context);
      } catch {
        throw new PublishTransportError('HTTP publishing authorization failed.');
      }
      const authorized = new Headers(supplied);
      for (const name of MANAGED_HEADERS) {
        if (authorized.has(name)) {
          throw new PublishTransportError(
            `Authorization must not override managed header "${name}".`,
          );
        }
      }
      authorized.forEach((value, name) => headers.set(name, value));
    }
    new Headers(managed).forEach((value, name) => headers.set(name, value));
    headers.set('X-VoiceGIS-Publish-Protocol', '0.1.0');
    return headers;
  }

  private async send(
    context: HttpPublishAuthorizationContext,
    init: Omit<RequestInit, 'headers'> & { headers: HeadersInit },
  ) {
    const url = requireHttpsUrl(context.url);
    const headers = await this.requestHeaders({ ...context, url }, init.headers);
    try {
      return await this.request(url, {
        ...init,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      if (error instanceof PublishTransportError) throw error;
      throw new PublishTransportError(`HTTP ${context.method} request failed.`);
    }
  }

  async readCatalog(url: string): Promise<PublishCatalogSnapshot> {
    const response = await this.send(
      { method: 'GET', purpose: 'catalog-read', url },
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      },
    );
    if (response.status !== 200) throw responseError('GET', response);

    const catalog = parseCatalogText(await response.text());
    const revision = requireStrongDigestEtag(response, 'Catalog read');
    const canonicalRevision = await calculateTextSha256(stablePackageJson(catalog));
    if (revision !== canonicalRevision) {
      throw new PublishTransportError(
        'Catalog ETag does not match the deterministic catalog revision.',
      );
    }
    return { catalog: structuredClone(catalog), revision };
  }

  async putPackage(request: PublishPackageRequest): Promise<PublishPackageResult> {
    requireDigest(request.artifactHash, 'Artifact hash');
    if (
      request.mediaType !== 'application/json' ||
      (await calculateTextSha256(request.text)) !== request.artifactHash ||
      utf8ByteLength(request.text) !== request.byteLength
    ) {
      throw new PublishTransportError(
        'Package bytes do not match the declared HTTP artifact metadata.',
      );
    }

    const response = await this.send(
      { method: 'PUT', purpose: 'package-upload', url: request.url },
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': request.mediaType,
          'If-None-Match': '*',
          'X-VoiceGIS-Artifact-Bytes': String(request.byteLength),
          'X-VoiceGIS-Artifact-SHA256': request.artifactHash,
        },
        body: request.text,
      },
    );
    const responseHash = optionalStrongDigestEtag(response);
    if (response.status === 412 && responseHash === request.artifactHash) {
      return { created: false, artifactHash: responseHash };
    }
    if (![200, 201, 204].includes(response.status)) {
      throw responseError('PUT', response);
    }
    if (responseHash !== request.artifactHash) {
      throw new PublishTransportError(
        'Package upload ETag does not match the uploaded artifact digest.',
      );
    }
    return {
      created: response.status === 201,
      artifactHash: responseHash,
    };
  }

  async compareAndSwapCatalog(
    url: string,
    expectedRevision: string,
    catalog: VenueVersionCatalog,
  ): Promise<PublishCatalogSnapshot> {
    requireDigest(expectedRevision, 'Expected catalog revision');
    const validated = parseVenueVersionCatalog(structuredClone(catalog));
    const text = stablePackageJson(validated);
    const nextRevision = await calculateTextSha256(text);
    const response = await this.send(
      { method: 'PATCH', purpose: 'catalog-commit', url },
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'If-Match': `"${expectedRevision}"`,
          'X-VoiceGIS-Catalog-Revision': nextRevision,
        },
        body: text,
      },
    );

    if (response.status === 409 || response.status === 412) {
      throw new PublishConflictError({
        expectedRevision,
        actualRevision: optionalStrongDigestEtag(response) ?? 'unknown',
        stage: 'catalog-commit',
        packageStored: true,
      });
    }
    if (response.status !== 200 && response.status !== 204) {
      throw responseError('PATCH', response);
    }

    const committedRevision = requireStrongDigestEtag(response, 'Catalog commit');
    if (committedRevision !== nextRevision) {
      throw new PublishTransportError(
        'Catalog commit ETag does not match the proposed deterministic revision.',
      );
    }
    const committedCatalog =
      response.status === 204 ? validated : parseCatalogText(await response.text());
    if (stablePackageJson(committedCatalog) !== text) {
      throw new PublishTransportError('Catalog commit response differs from the proposed catalog.');
    }
    return {
      catalog: structuredClone(committedCatalog),
      revision: committedRevision,
    };
  }
}
