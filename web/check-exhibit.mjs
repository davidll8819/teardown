// Manual local regression check of trusted repository code, not an AI-generation
// benchmark or a production isolation test. Requires an installed Chrome.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {makeSimulatorHtml} from './generator.mjs';
import {inspectExhibit} from './exhibit-inspection.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../.taste-skill/exhibit-restoration/', import.meta.url);
await mkdir(output, {recursive: true});
const compiled = await build({stdin: {contents: "import {createExhibitFixture} from './web/exhibit-fixture.mjs'; createExhibitFixture(document.getElementById('app'));", resolveDir: root}, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022'});
const html = makeSimulatorHtml(compiled.outputFiles[0].text);
await writeFile(new URL('fixture.html', output), html);
const browser = await chromium.launch({headless: true, channel: 'chrome', chromiumSandbox: true, args: ['--enable-unsafe-swiftshader']});
const errors = [];
const report = {provenance: 'hand-authored V8 fixture, not AI generated', browserSandbox: true, errors, checks: [], viewports: []};
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  await page.route('**/*', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html, {waitUntil: 'load'});
  await page.waitForTimeout(600);
  const inspection = await inspectExhibit(page);
  report.interaction = {...inspection, frames: inspection.frames.map(frame => frame.mode)};
  for (const frame of inspection.frames) await writeFile(new URL(`${frame.mode}.jpg`, output), Buffer.from(frame.image, 'base64'));
  assert.deepEqual(inspection.failures, [], 'fixed presentation interaction checks failed');
  await page.evaluate(() => {const api = window.__TEARDOWN_EXHIBIT__; api.setTour(false); api.setPaused(true); api.setTime(2); api.setParameter('rpm', 12);});
  const first = await page.locator('[data-exhibit-readout="crank-angle"]').getAttribute('data-value');
  await page.locator('[data-exhibit-parameter="rpm"]').fill('24');
  const changed = await page.locator('[data-exhibit-readout="crank-angle"]').getAttribute('data-value');
  assert.equal(Number(first), 144);
  assert.equal(Number(changed), 288);
  report.checks.push('parameter changes the shared model and real readout');
  await page.locator('[data-exhibit-select-part="crank"]').click();
  assert.match(await page.locator('.td-exhibit__selection-description').innerText(), /四组/);
  report.checks.push('named part selection explains actual subsystem');
  await page.evaluate(() => {window.__TEARDOWN_EXHIBIT__.setTour(true); window.__TEARDOWN_EXHIBIT__.selectPart('crank');});
  assert.equal(await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.snapshot().tour.active), false);
  await page.waitForTimeout(25_350);
  assert.equal(await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.snapshot().tour.active), true);
  report.checks.push('manual takeover resumes touring after 25 seconds of real idle time');
  await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.setTour(false));
  await page.waitForTimeout(25_350);
  assert.equal(await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.snapshot().tour.active), false);
  report.checks.push('explicitly disabled touring stays off after idle timeout');
  await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.setPaused(true));
  for (const [width, height] of [[1440, 900], [768, 1000], [390, 844]]) {
    await page.setViewportSize({width, height});
    await page.evaluate(() => {window.__TEARDOWN_EXHIBIT__.setMode('cutaway'); document.querySelector('.td-exhibit').scrollTop = 0;});
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => {
      const shell = document.querySelector('.td-exhibit');
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      return {clientWidth: shell.clientWidth, scrollWidth: shell.scrollWidth, height: shell.clientHeight, scrollHeight: shell.scrollHeight, canvas: {width: canvas.width, height: canvas.height}, overflow: getComputedStyle(shell).overflowY};
    });
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'exhibit overflows horizontally');
    assert.ok(layout.canvas.width > 200 && layout.canvas.height > 250, 'model lost its viewport');
    if (layout.scrollHeight > layout.height + 1) assert.ok(['auto', 'scroll'].includes(layout.overflow), 'controls beyond the viewport must remain scrollable');
    await page.screenshot({path: fileURLToPath(new URL(`viewport-${width}.png`, output))});
    await page.locator('[data-exhibit-action="tour"]').scrollIntoViewIfNeeded();
    await page.locator('[data-exhibit-action="tour"]').click();
    assert.equal(await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.snapshot().tour.active), true);
    await page.screenshot({path: fileURLToPath(new URL(`controls-${width}.png`, output))});
    await page.evaluate(() => {window.__TEARDOWN_EXHIBIT__.setTour(false); window.__TEARDOWN_EXHIBIT__.setPaused(true);});
    report.viewports.push({width, height, ...layout});
  }
  await page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.snapshot().paused), true);
  assert.equal(await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.snapshot().tour.enabled), false);
  report.checks.push('reduced motion pauses animation and disables automatic touring');
  await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.dispose());
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.evaluate(() => window.__TEARDOWN_EXHIBIT__ === undefined), true);
  report.checks.push('dispose removes canvas, UI and diagnostic interface');
  assert.deepEqual(errors, []);
  report.rejectionCases = [];
  for (const scenario of ['all_covers', 'prehidden', 'late_nan', 'late_throw']) {
    const source = `import * as THREE from 'three'; import {createMechanicalExhibit} from './web/simulator-exhibit.js';
const root=new THREE.Group(), shell=new THREE.Group(), rotor=new THREE.Group();
shell.add(new THREE.Mesh(new THREE.BoxGeometry(2,2,0.2),new THREE.MeshStandardMaterial()));
rotor.add(new THREE.Mesh(new THREE.TorusGeometry(0.5,0.1,8,16),new THREE.MeshStandardMaterial()));
shell.position.z=-0.4; root.add(shell,rotor); ${scenario === 'prehidden' ? 'shell.visible=false;' : ''}
createMechanicalExhibit({container:document.getElementById('app'),title:'Negative regression fixture',root,
parts:[{id:'shell',object:shell,cutaway:${scenario !== 'prehidden'},explode:[0,0,-1]},{id:'rotor',object:rotor,cutaway:${scenario === 'all_covers'},explode:[0,0,1]}],
parameters:[{id:'speed',label:'speed',value:1,min:0,max:2}],readouts:[{id:'value',key:'value'}],
model:({time})=>({time,value:${scenario === 'late_nan' ? 'time>0.18?NaN:time' : 'time'}}),
update:state=>{${scenario === 'late_throw' ? "if(state.time>0.18)throw new Error('fixture_failure');" : ''}rotor.rotation.z=state.time;}});`;
    const result = await build({stdin: {contents: source, resolveDir: root}, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022'});
    await page.setViewportSize({width: 1200, height: 800});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.setContent(makeSimulatorHtml(result.outputFiles[0].text), {waitUntil: 'load'});
    const rejected = await inspectExhibit(page);
    assert.equal(rejected.passed, false, `${scenario} must not be accepted`);
    assert.ok(rejected.failures.includes(['all_covers', 'prehidden'].includes(scenario) ? 'cutaway_reveals_interior' : 'runtime_state_valid'));
    report.rejectionCases.push({scenario, failures: rejected.failures});
    await page.evaluate(() => window.__TEARDOWN_EXHIBIT__.dispose());
  }
  console.log(JSON.stringify(report));
} finally {
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await browser.close();
}
