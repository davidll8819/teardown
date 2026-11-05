// Browser regression with deterministic HTTP fixtures, not a real model or
// multi-account isolation certification. No user profile, data or keys are read.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, '.taste-skill', 'preview-loading');
await mkdir(output, {recursive: true});
const origin = 'https://preview-regression.invalid';
const jobs = ['A', 'B'].map((label, i) => ({id: `10000000-0000-4000-8000-00000000000${i}`, description: `测试${label} · 电机拆解`, status: 'completed', createdAt: '2026-11-06T01:00:00Z', updatedAt: '2026-11-06T01:01:00Z', references: []}));
const fixture = label => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="connect-src 'none'"><style>html,body,main{margin:0;height:100%;background:#181818;color:#eee;font:16px system-ui}main{display:grid;place-content:center;text-align:center}canvas{width:240px;height:240px}p{margin:12px}</style></head><body><main id="app"><canvas width="240" height="240"></canvas><p>Fixture ${label}</p></main><script>const c=document.querySelector('canvas').getContext('2d');c.fillStyle='#b1b5ba';c.beginPath();c.arc(120,120,90,0,2*Math.PI);c.fill();c.fillStyle='#181818';c.beginPath();c.arc(120,120,25,0,2*Math.PI);c.fill();window.fixture=${JSON.stringify(label)};try{parent.document.querySelector('body');window.parentBlocked=false}catch{window.parentBlocked=true}fetch('https://blocked-regression.invalid/should-not-leave').catch(()=>{});</script></body></html>`;
const report = {kind: 'fixture-browser-regression', generatedModel: false, checks: [], screenshots: [], pageErrors: [], unexpectedRequests: []};
let mode = 'missing', releaseLate, lateStarted;
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 960}, acceptDownloads: true});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {report.unexpectedRequests.push(url.href); return route.abort();}
    if (url.pathname === '/api/jobs') return route.fulfill({json: {jobs}});
    if (url.pathname.endsWith('/preview')) {
      const label = url.pathname.includes(jobs[1].id) ? 'B' : 'A';
      if (label === 'A' && mode === 'late') {lateStarted?.(); await new Promise(resolve => {releaseLate = resolve;});}
      if (mode === 'missing') return route.fulfill({status: 404, json: {error: 'job_not_found'}});
      if (mode === 'auth') return route.fulfill({status: 401, json: {error: 'unauthorized'}});
      if (mode === 'storage') return route.fulfill({status: 503, json: {error: 'storage_unavailable'}});
      if (mode === 'redirect') return route.fulfill({status: 302, headers: {location: '/login'}, body: ''});
      if (mode === 'login') return route.fulfill({contentType: 'text/html', body: '<!doctype html><html><head><title>Login</title></head><body>Sign in</body></html>'});
      if (mode === 'stall') return;
      return route.fulfill({contentType: 'text/html', body: fixture(label)}).catch(() => {});
    }
    const assets = {'/': ['index.html', 'text/html'], '/assets/app.js': ['assets/app.js', 'text/javascript'], '/assets/app.css': ['assets/app.css', 'text/css'], '/assets/inter-latin.woff2': ['assets/inter-latin.woff2', 'font/woff2']};
    const asset = assets[url.pathname];
    if (asset) return route.fulfill({contentType: asset[1], body: await readFile(path.join(root, 'web-dist', asset[0]))});
    return route.fulfill({status: 404, body: 'Not found'});
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  const capture = async name => {const file = path.join(output, `${name}.png`); await page.screenshot({path: file, fullPage: true}); report.screenshots.push(file);};
  const text = () => page.locator('.preview-status').innerText();
  const frameReady = async expected => {await page.frameLocator('iframe[title="模拟器预览"]').getByText(`Fixture ${expected}`, {exact: true}).waitFor(); await page.locator('.preview-status').waitFor({state: 'hidden'});};
  await page.goto(origin);
  await page.getByRole('heading', {name: '模拟器暂时无法显示'}).waitFor();
  assert.match(await text(), /当前账号或应用实例/);
  assert.doesNotMatch(await text(), /删除/);
  assert.equal(await page.locator('iframe').count(), 0);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({width, height: 960});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal overflow at ${width}`);
    const bounds = await page.getByRole('button', {name: '重新载入结果', exact: true}).boundingBox();
    assert.ok(bounds.width > 100 && bounds.height >= 40);
    await capture(`missing-${width}`);
  }
  report.checks.push('404 visible without claiming deletion; no iframe; 1440/768/390 responsive recovery');
  await page.setViewportSize({width: 1440, height: 960});
  for (const [value, expected] of [['auth', /登录状态已失效/], ['storage', /暂时无法读取结果存储/], ['redirect', /跳转到了其他页面/], ['login', /没有返回有效的模拟器页面/]]) {
    mode = value; await page.getByRole('button', {name: '重新载入结果', exact: true}).click();
    await page.getByRole('heading', {name: '模拟器暂时无法显示'}).waitFor();
    assert.match(await text(), expected);
    assert.equal(await page.locator('iframe').count(), 0);
    report.checks.push(`${value} visible and no blank iframe`);
  }
  mode = 'ready'; await page.getByRole('button', {name: '重新载入结果', exact: true}).click(); await frameReady('A');
  const iframe = page.locator('iframe[title="模拟器预览"]');
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await iframe.getAttribute('src'), null);
  const frame = await (await iframe.elementHandle()).contentFrame();
  assert.equal(await frame.evaluate(() => window.parentBlocked), true);
  assert.equal(await frame.locator('meta[http-equiv="Content-Security-Policy"]').count(), 2);
  await capture('ready-1440');
  report.checks.push('retry recovers; scripts/canvas render in opaque srcDoc; parent DOM blocked; fixed CSP preserved');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: '下载 HTML', exact: true}).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^teardown-.*\.html$/);
  assert.equal(await readFile(await download.path(), 'utf8'), fixture('A'));
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', {name: '独立窗口'}).click();
  const popup = await popupPromise; await popup.getByText('Fixture A', {exact: true}).waitFor(); await popup.close();
  report.checks.push('authorized HTML download and independent window retained');
  mode = 'late';
  const began = new Promise(resolve => {lateStarted = resolve;});
  await page.reload(); await began;
  await page.locator('.task').filter({hasText: jobs[1].description}).click(); await frameReady('B');
  releaseLate(); await page.waitForTimeout(200); await frameReady('B');
  assert.equal(await page.locator('iframe').count(), 1);
  report.checks.push('switching task aborts A; late A cannot replace B');
  mode = 'stall'; await page.clock.install(); await page.reload();
  await page.getByRole('heading', {name: '正在载入模拟器'}).waitFor();
  await page.clock.fastForward(20_100);
  await page.getByRole('heading', {name: '模拟器暂时无法显示'}).waitFor();
  assert.match(await text(), /载入结果超时/);
  report.checks.push('20-second timeout visibly recovers from stalled preview (browser clock)');
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.unexpectedRequests, []);
  report.checks.push('no uncaught page errors; iframe CSP prevented external fetch before network');
} finally {
  await browser.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
