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

export async function htmlToPdf(html: string): Promise<Buffer> {
  const executablePath = resolveChromiumPath();
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
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
