import { describe, expect, it } from 'vitest';
import { underBase } from './appPath';

describe('server paths under the base the app is hosted at', () => {
  it('leaves every path alone at a domain root', () => {
    expect(underBase('/venues/catalog.json', '/')).toBe('/venues/catalog.json');
  });

  it('moves a root-relative path under a project site', () => {
    expect(underBase('/venues/catalog.json', '/voicegis-indoor-ar/')).toBe(
      '/voicegis-indoor-ar/venues/catalog.json',
    );
    expect(underBase('/sw.js', '/voicegis-indoor-ar')).toBe('/voicegis-indoor-ar/sw.js');
  });

  it('does not move a path twice', () => {
    expect(underBase('/voicegis-indoor-ar/venues/a.json', '/voicegis-indoor-ar/')).toBe(
      '/voicegis-indoor-ar/venues/a.json',
    );
  });

  it('leaves full, protocol-relative and page-relative URLs as they are', () => {
    for (const url of [
      'https://example.org/venues/a.json',
      '//cdn.example.org/a.json',
      'venues/a.json',
    ])
      expect(underBase(url, '/voicegis-indoor-ar/')).toBe(url);
  });

  it('does not mistake a sibling path sharing the prefix for one already moved', () => {
    expect(underBase('/voicegis-indoor-ar-old/a.json', '/voicegis-indoor-ar/')).toBe(
      '/voicegis-indoor-ar/voicegis-indoor-ar-old/a.json',
    );
  });
});
