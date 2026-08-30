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
  it('uses the same cream surface in HTML, the manifest and the launch screen', () => {
    expect(index).toContain('<meta name="theme-color" content="#fff9f0" />');
    expect(index).toContain('name="apple-mobile-web-app-status-bar-style" content="default"');
    expect(manifest.theme_color).toBe('#fff9f0');
    expect(manifest.background_color).toBe('#fff9f0');
  });

  it('carries the current cream-and-blue mark instead of the retired dark icon', () => {
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purpose: 'any maskable',
          src: '/favicon.svg',
          type: 'image/svg+xml',
        }),
      ]),
    );
    expect(favicon).toContain('#fff9f0');
    expect(favicon).toContain('#0a65db');
    expect(favicon).not.toContain('#0a0e1a');
  });

  it('describes the delivered product consistently to link previews', () => {
    expect(index).toContain('<meta property="og:title" content="VoiceGIS Indoor Navigation" />');
    expect(index).toContain('name="twitter:card" content="summary"');
    expect(index).toContain('QR check-in, cold-offline wayfinding');
  });
});
