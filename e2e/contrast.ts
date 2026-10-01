import type { Page } from '@playwright/test';

/*
 * Text contrast, measured from the pixels.
 *
 * Every surface in the app is glass: a translucent tint over a blurred sky,
 * the building model or live video. No declared background colour says what
 * a word is actually sitting on, so nothing here reads the stylesheet. The
 * text is hidden, the page is photographed, and each run's colour is compared
 * with the pixels that were behind it.
 *
 * The figure for a run is its tenth-percentile pixel: the bad patch, without
 * one stray pixel on a border deciding it.
 */

export interface TextRun {
  text: string;
  where: string;
  color: string;
  /** CSS pixels. */
  size: number;
  weight: number;
  /** The product of every ancestor's opacity. */
  opacity: number;
  disabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeasuredRun extends TextRun {
  ratio: number;
  /** 3 for large type, 4.5 otherwise: WCAG 2.1 AA. */
  required: number;
}

/*
 * Transitions are switched off in the same rule that hides the text. Several
 * controls animate `color`, and a screenshot taken while the words are still
 * fading out measures white text against itself.
 */
const HIDE_TEXT =
  '*,*::before,*::after,*::placeholder{transition:none!important;color:transparent!important;' +
  '-webkit-text-fill-color:transparent!important;text-decoration-color:transparent!important;' +
  'caret-color:transparent!important}svg{visibility:hidden!important}';

/** Every run of text that is on screen, on top, and not scrolled out of its container. */
function collectRuns(selector: string | null): TextRun[] {
  const runs: TextRun[] = [];
  const seen = new Set<Element>();
  const roots = selector === null ? [document.body] : [...document.querySelectorAll(selector)];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? '').trim();
      const element = node.parentElement;
      if (text.length < 2 || element === null || seen.has(element)) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const full = range.getBoundingClientRect();
      // Only the part an overflow-clipping ancestor leaves showing.
      let left = full.left;
      let top = full.top;
      let right = full.right;
      let bottom = full.bottom;
      let opacity = 1;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        opacity *= Number(ancestorStyle.opacity);
        if (ancestor === document.body) continue;
        if (ancestorStyle.overflowX !== 'visible' || ancestorStyle.overflowY !== 'visible') {
          const box = ancestor.getBoundingClientRect();
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      left = Math.max(left, 0);
      top = Math.max(top, 0);
      right = Math.min(right, innerWidth);
      bottom = Math.min(bottom, innerHeight);
      const width = right - left;
      const height = bottom - top;
      if (opacity === 0 || width < 4 || height < 4) continue;
      // A run mostly scrolled or clipped away is not being read.
      if (height < full.height * 0.8 || width < Math.min(full.width, 40) * 0.8) continue;
      const hit = document.elementFromPoint(left + width / 2, top + height / 2);
      if (hit === null || !(hit === element || element.contains(hit) || hit.contains(element)))
        continue;

      seen.add(element);
      runs.push({
        text: text.slice(0, 48),
        where:
          typeof element.className === 'string' && element.className
            ? `.${element.className}`
            : element.tagName.toLowerCase(),
        color: style.color,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
        opacity,
        disabled: element.closest(':disabled,[aria-disabled="true"]') !== null,
        x: left,
        y: top,
        width,
        height,
      });
    }
  }
  return runs;
}

async function ratiosFor(page: Page, runs: TextRun[], shot: string): Promise<number[]> {
  return page.evaluate(
    async ({ shot, runs }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${shot}`;
      await image.decode();
      const scale = image.width / innerWidth;
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (r: number, g: number, b: number) =>
        0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      return runs.map((run) => {
        const [r, g, b, declared = 1] = (run.color.match(/[\d.]+/g) ?? []).map(Number);
        const alpha = declared * run.opacity;
        const x = Math.max(0, Math.round(run.x * scale));
        const y = Math.max(0, Math.round(run.y * scale));
        const width = Math.min(canvas.width - x, Math.round(run.width * scale));
        const height = Math.min(canvas.height - y, Math.round(run.height * scale));
        if (width < 2 || height < 2) return Number.POSITIVE_INFINITY;
        const { data } = context.getImageData(x, y, width, height);
        const ratios: number[] = [];
        for (let index = 0; index < data.length; index += 4) {
          const [br, bg, bb] = [data[index], data[index + 1], data[index + 2]];
          // The text as drawn: its own colour laid over this pixel at its alpha.
          const text = luminance(
            r * alpha + br * (1 - alpha),
            g * alpha + bg * (1 - alpha),
            b * alpha + bb * (1 - alpha),
          );
          const behind = luminance(br, bg, bb);
          ratios.push((Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05));
        }
        ratios.sort((first, second) => first - second);
        return ratios[Math.floor(ratios.length * 0.1)];
      });
    },
    { shot, runs },
  );
}

/**
 * Measures every visible run of text on the page, or inside `selector`.
 * Disabled controls are left out: WCAG exempts them, and they are meant to recede.
 */
export async function measureTextContrast(
  page: Page,
  selector: string | null = null,
): Promise<MeasuredRun[]> {
  const runs = (await page.evaluate(collectRuns, selector)).filter((run) => !run.disabled);
  if (runs.length === 0) return [];
  const hidden = await page.addStyleTag({ content: HIDE_TEXT });
  const shot = (await page.screenshot({ type: 'png' })).toString('base64');
  await hidden.evaluate((node) => node.parentNode?.removeChild(node));
  const ratios = await ratiosFor(page, runs, shot);
  return runs.map((run, index) => ({
    ...run,
    ratio: ratios[index],
    required: run.size >= 24 || (run.size >= 18.66 && run.weight >= 700) ? 3 : 4.5,
  }));
}

/** The runs that fall short, worst first, as lines a failure message can show. */
export function tooFaint(runs: MeasuredRun[]): string[] {
  return runs
    .filter((run) => run.ratio < run.required)
    .sort((first, second) => first.ratio - second.ratio)
    .map(
      (run) =>
        `${run.ratio.toFixed(2)}:1 (needs ${run.required})  ${run.size}px ${run.color}  ${run.where}  "${run.text}"`,
    );
}
