// @ts-check

/**
 * Recognises the Vite preview banner that says this run's server is listening.
 *
 * Vite colourises its startup banner whenever the environment looks like a
 * terminal or a CI system, and GitHub Actions sets `CI`. The port is wrapped in
 * a bold sequence of its own, so the bytes of the ready line are
 * `http://127.0.0.1:` ESC `[1m` `4187` ESC `[22m` `/`. A pattern that expects
 * the port to follow the colon directly therefore never matches a coloured
 * banner: the preview is healthy and serving, but the runner waits out its full
 * timeout and the browser gate never starts. Strip the sequences before
 * matching rather than trying to spell them out.
 */
const CONTROL_SEQUENCE = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g');

/** @param {string} text */
export function withoutControlSequences(text) {
  return text.replace(CONTROL_SEQUENCE, '');
}

/**
 * @param {string} output Accumulated preview stdout, coloured or not.
 * @param {number} port The port this run asked for with `--strictPort`.
 */
export function announcesPreviewOn(output, port) {
  const banner = new RegExp('Local:\\s+http://127\\.0\\.0\\.1:' + String(port) + '/');
  return banner.test(withoutControlSequences(output));
}
