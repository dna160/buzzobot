import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

/**
 * Convert a self-contained HTML string into a PDF using headless Chromium.
 * Kept isolated so the heavy browser dependency is only loaded by the report
 * route, never bundled into the client or the rest of the server graph.
 */

/**
 * Resolve a Chromium executable. Order:
 *  1. PLAYWRIGHT_CHROMIUM_PATH (explicit override, best for prod containers).
 *  2. A "chromium-<rev>/chrome-linux/chrome" under PLAYWRIGHT_BROWSERS_PATH.
 *  3. undefined → let Playwright use its own managed download.
 */
function resolveChromiumPath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH && existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const chromeWin = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (existsSync(chromeWin)) return chromeWin;
  const edgeWin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (existsSync(edgeWin)) return edgeWin;
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH && existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const candidates = readdirSync(base)
    .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const exe = join(base, dir, 'chrome-linux', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const FOOTER =
  '<div style="width:100%;font-size:8px;color:#9AA1AB;font-family:Arial,sans-serif;' +
  'padding:0 14mm;display:flex;justify-content:space-between;">' +
  '<span>Tempo Insight Engine</span>' +
  '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
  '</div>';

/**
 * `a4` is the portrait report pipeline, unchanged: A4 pages with a Chromium-drawn
 * page-number footer.
 *
 * `deck` is the Brief Deck (PRD §6): 16:9 landscape, zero margin, and
 * `preferCSSPageSize` so the document's own `@page { size: 338.67mm 190.5mm }`
 * is authoritative — one slide is one page, and the geometry lives with the
 * design rather than being asserted twice. No Chromium header/footer either:
 * the deck draws its own provenance footer inside each slide, and a second
 * footer over a full-bleed cover would print across the artwork.
 */
export type PdfMode = 'a4' | 'deck';

export async function htmlToPdf(html: string, mode: PdfMode = 'a4'): Promise<Buffer> {
  const executablePath = resolveChromiumPath();
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    // The deck embeds every asset, so there is nothing to wait for on the
    // network — but `networkidle` is harmless and keeps one code path.
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf =
      mode === 'deck'
        ? await page.pdf({
            preferCSSPageSize: true,
            printBackground: true,
            landscape: true,
            margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
          })
        : await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: FOOTER,
            margin: { top: '10mm', bottom: '14mm', left: '0mm', right: '0mm' },
          });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
