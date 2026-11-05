// Explicit local browser regression probe, not a generated-model quality check.
// Uses a fresh headless browser profile, never the user's open Chrome session.
// Run: node web/preview-bootstrap.browser.mjs
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {makeSimulatorHtml} from './generator.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, '.taste-skill', 'preview-bootstrap');
await mkdir(output, {recursive: true});
const previewCsp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
const bundle = async source => (await build({stdin: {contents: source, resolveDir: root, sourcefile: 'bootstrap-fixture.js'}, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true, logLevel: 'silent'})).outputFiles[0].text;
const fixture = await bundle("import {createExhibitFixture} from './web/exhibit-fixture.mjs'; createExhibitFixture(document.getElementById('app'));");
const invalidRoot = await bundle("import {createMechanicalExhibit} from './web/simulator-exhibit.js'; createMechanicalExhibit({container:document.getElementById('app'),root:null,model:()=>({}),update:()=>{}});");
const report = {kind: 'hand-authored-bootstrap-regression', generated: false, checks: []};

async function openPreview(browser, script, {srcdoc = false} = {}) {
  const page = await browser.newPage({viewport: {width: 1100, height: 800}, deviceScaleFactor: 1});
  const errors = [], deniedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  const html = makeSimulatorHtml(script);
  // Virtual HTTP responses apply BOTH production-style header CSP and the
  // iframe sandbox. Any unrecognised URL is denied before network access.
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url === 'https://teardown-bootstrap.invalid/') return route.fulfill({status: 200, contentType: 'text/html', body: `<!doctype html><html><body style="margin:0"><iframe title="Bootstrap regression" sandbox="allow-scripts" ${srcdoc ? '' : 'src="/preview"'} style="display:block;width:100vw;height:100vh;border:0"></iframe>${srcdoc ? `<script>const frame=document.querySelector('iframe');frame.addEventListener('load',()=>{if(frame.srcdoc){frame.dataset.loaded='1';window.previewLoads=(window.previewLoads||0)+1;}});fetch('/preview').then(response=>response.text()).then(html=>{frame.srcdoc=html;});</script>` : ''}</body></html>`});
    if (url === 'https://teardown-bootstrap.invalid/preview') return route.fulfill({status: 200, headers: {'content-type': 'text/html; charset=utf-8', 'content-security-policy': previewCsp}, body: html});
    deniedRequests.push(url); return route.abort();
  });
  await page.goto('https://teardown-bootstrap.invalid/', {waitUntil: 'load'});
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  assert.ok(frame, 'sandboxed preview frame exists');
  await frame.waitForFunction(() => document.getElementById('teardown-boot'));
  return {page, frame, errors, deniedRequests};
}

async function checkFailure(browser, {name, script, message, state = 'error', timeout = 5000}) {
  const context = await openPreview(browser, script);
  try {
    await context.frame.waitForFunction(expected => document.getElementById('teardown-boot').dataset.state === expected, state, {timeout});
    const panel = context.frame.locator('#teardown-boot');
    assert.equal(await panel.isVisible(), true);
    assert.match(await context.frame.locator('#teardown-boot-detail').innerText(), message);
    assert.equal(await context.frame.locator('#teardown-boot-retry').isVisible(), true);
    if (state === 'error') assert.ok(context.errors.length > 0, 'uncaught browser error remains observable');
    await context.page.screenshot({path: path.join(output, `${name}.png`)});
    report.checks.push({name, displayed: true, errorPreserved: state === 'error' ? context.errors.length > 0 : null});
  } finally {await context.page.close();}
}

let browser;
try {
  browser = await chromium.launch({channel: 'chrome', headless: true, chromiumSandbox: true, args: ['--enable-unsafe-swiftshader']});
  await checkFailure(browser, {name: 'constructor-error', script: invalidRoot, message: /exhibit_root_required/});
  await checkFailure(browser, {name: 'promise-error', script: "Promise.reject(new Error('bootstrap_async_fixture'));", message: /bootstrap_async_fixture/});
  await checkFailure(browser, {name: 'missing-mount', script: '/* Deliberately no mount: timeout feedback fixture. */', state: 'timeout', message: /超过 10 秒/, timeout: 13000});

  const literal = "<img src=x onerror='window.errorMarkupExecuted=true'>";
  const escaping = await openPreview(browser, `throw new Error(${JSON.stringify(literal)});`);
  try {
    await escaping.frame.waitForFunction(() => document.getElementById('teardown-boot').dataset.state === 'error');
    assert.equal(await escaping.frame.locator('#teardown-boot-detail').innerText(), literal);
    assert.equal(await escaping.frame.locator('#teardown-boot-detail img').count(), 0);
    assert.equal(await escaping.frame.evaluate(() => window.errorMarkupExecuted === true), false);
    report.checks.push({name: 'error-is-text-not-html', passed: true});
  } finally {await escaping.page.close();}

  const normal = await openPreview(browser, fixture);
  try {
    await normal.frame.waitForFunction(() => document.getElementById('teardown-boot').hidden, null, {timeout: 10000});
    assert.equal(await normal.frame.locator('#teardown-boot').getAttribute('data-state'), 'displayed');
    assert.equal(await normal.frame.locator('[data-exhibit-action="assembled"]').isVisible(), true);
    assert.equal(await normal.frame.evaluate(() => window.__TEARDOWN_EXHIBIT__.snapshot().error), null);
    assert.equal(normal.errors.length, 0);
    const parentDenied = await normal.frame.evaluate(() => {try {void parent.document; return false;} catch {return true;}});
    assert.equal(parentDenied, true, 'opaque sandbox cannot read parent document');
    const networkDenied = await normal.frame.evaluate(async () => {try {await fetch('/unexpected'); return false;} catch {return true;}});
    assert.equal(networkDenied, true, 'connect-src remains none');
    assert.equal(normal.deniedRequests.length, 0, 'CSP prevented the fetch before network routing');
    await normal.page.screenshot({path: path.join(output, 'normal-fixture.png')});
    report.checks.push({name: 'normal-fixture-displays', passed: true}, {name: 'sandbox-and-connect-csp-preserved', passed: true});
  } finally {await normal.page.close();}

  // The workspace now authenticates the preview fetch in the parent, then
  // mounts srcDoc. Its document must retain the meta CSP and opaque sandbox;
  // reloading this document must not make it blank or submit another job.
  const srcdoc = await openPreview(browser, fixture, {srcdoc: true});
  try {
    await srcdoc.frame.waitForFunction(() => document.getElementById('teardown-boot').hidden);
    assert.equal(await srcdoc.frame.title(), '3D simulator');
    assert.equal(await srcdoc.frame.evaluate(() => {try {void parent.document; return false;} catch {return true;}}), true);
    assert.equal(await srcdoc.frame.evaluate(async () => {try {await fetch('/unexpected'); return false;} catch {return true;}}), true);
    assert.equal(srcdoc.errors.length, 0);
    report.checks.push({name: 'srcdoc-display-and-isolation', passed: true});
  } finally {await srcdoc.page.close();}

  const srcdocFailure = await openPreview(browser, "throw new Error('srcdoc_retry_fixture');", {srcdoc: true});
  try {
    await srcdocFailure.frame.locator('#teardown-boot[data-state="error"]').waitFor();
    const before = await srcdocFailure.page.evaluate(() => window.previewLoads);
    await srcdocFailure.frame.locator('#teardown-boot-retry').click();
    await srcdocFailure.page.waitForFunction(count => window.previewLoads > count, before);
    const reloaded = srcdocFailure.page.frames().find(frame => frame.url() === 'about:srcdoc');
    await reloaded.locator('#teardown-boot[data-state="error"]').waitFor();
    assert.match(await reloaded.locator('#teardown-boot-detail').innerText(), /srcdoc_retry_fixture/);
    assert.equal(srcdocFailure.deniedRequests.length, 0);
    report.checks.push({name: 'srcdoc-reload-preserves-diagnostics', passed: true});
  } finally {await srcdocFailure.page.close();}
  await browser.close(); browser = null;

  // Real browser startup denial exercises the actual THREE renderer failure.
  browser = await chromium.launch({channel: 'chrome', headless: true, chromiumSandbox: true, args: ['--disable-webgl']});
  await checkFailure(browser, {name: 'webgl-unavailable', script: fixture, message: /WebGL/i});
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {if (browser) await browser.close();}
