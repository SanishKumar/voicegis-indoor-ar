import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync('index.html', 'utf8');
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
  background_color?: string;
  theme_color?: string;
  icons?: Array<{ purpose?: string; src?: string; type?: string }>;
};
const favicon = readFileSync('public/favicon.svg', 'utf8');

describe('installed visitor chrome', () => {
  it('uses the same black canvas in HTML, the manifest and the launch screen', () => {
    expect(index).toContain('<meta name="theme-color" content="#000000" />');
    expect(index).toContain('name="apple-mobile-web-app-status-bar-style" content="black"');
    expect(manifest.theme_color).toBe('#000000');
    expect(manifest.background_color).toBe('#000000');
  });

  it('carries the current black, white and blue mark', () => {
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purpose: 'any maskable',
          // Relative to the manifest, so the icon is found under any base the app is hosted at.
          src: 'favicon.svg',
          type: 'image/svg+xml',
        }),
      ]),
    );
    expect(favicon).toContain('#000000');
    expect(favicon).toContain('#2b7fff');
    expect(favicon).not.toContain('#fff9f0');
  });

  it('describes the delivered product consistently to link previews', () => {
    expect(index).toContain('<meta property="og:title" content="VoiceGIS Indoor Navigation" />');
    expect(index).toContain('name="twitter:card" content="summary"');
    expect(index).toContain('QR check-in, cold-offline wayfinding');
  });
});
