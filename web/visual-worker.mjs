import {chromium} from 'playwright';
import {inspectExhibit} from './exhibit-inspection.mjs';

const chunks = []; let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 2_500_000) throw new Error('input_too_large');
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (typeof input.html !== 'string' || !input.html || Buffer.byteLength(input.html) > 2_000_000) throw new Error('invalid_html');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport: {width: 1200, height: 800}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', () => { if (errors.length < 10) errors.push('page_error'); });
  await page.route('**/*', route => route.abort());
  await page.setContent(input.html, {waitUntil: 'load', timeout: 12000});
  await page.waitForTimeout(1500);
  const canvasCount = await page.locator('canvas').count();
  const screenshot = await page.screenshot({type: 'jpeg', quality: 65, timeout: 3000});
  const inspection = await inspectExhibit(page);
  console.log(JSON.stringify({canvasCount, errors, image: screenshot.toString('base64'),
    frames: inspection.frames,
    interaction: {passed: inspection.passed, checks: inspection.checks, failures: inspection.failures}}));
} finally { await browser.close(); }
