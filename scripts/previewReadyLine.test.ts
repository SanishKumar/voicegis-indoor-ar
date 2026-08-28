import { describe, expect, it } from 'vitest';
import { announcesPreviewOn, withoutControlSequences } from './previewReadyLine.js';

const ESCAPE = String.fromCharCode(27);

/**
 * Byte-for-byte what Vite 8 writes when it colourises, which it does whenever
 * `CI` is set - so this is the exact line the GitHub Actions browser job sees.
 */
const COLOURED_BANNER = `  ${ESCAPE}[32m➜${ESCAPE}[39m  ${ESCAPE}[1mLocal${ESCAPE}[22m:   ${ESCAPE}[36mhttp://127.0.0.1:${ESCAPE}[1m4187${ESCAPE}[22m/${ESCAPE}[39m\n`;
const PLAIN_BANNER = '  ➜  Local:   http://127.0.0.1:4187/\n';

describe('preview ready line', () => {
  it('recognises the coloured banner a CI environment produces', () => {
    expect(announcesPreviewOn(COLOURED_BANNER, 4187)).toBe(true);
  });

  it('recognises the uncoloured banner a plain pipe produces', () => {
    expect(announcesPreviewOn(PLAIN_BANNER, 4187)).toBe(true);
  });

  it('still refuses a banner announcing a different port', () => {
    expect(announcesPreviewOn(COLOURED_BANNER, 4188)).toBe(false);
    expect(announcesPreviewOn(PLAIN_BANNER, 4188)).toBe(false);
  });

  it('waits while the escape sequence around the port is still arriving', () => {
    const split = COLOURED_BANNER.slice(0, COLOURED_BANNER.indexOf('4187'));
    expect(announcesPreviewOn(split, 4187)).toBe(false);
  });

  it('removes cursor control as well as colour', () => {
    expect(withoutControlSequences(`${ESCAPE}[2Kbuilding${ESCAPE}[39m`)).toBe('building');
  });
});
