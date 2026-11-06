// Isolated browser fixtures for language state transitions. This is not a
// real 4yi route/cookie synchronization or multi-account isolation test.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  stdin: {resolveDir: root, loader: 'jsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useLocale} from './web/use-locale.jsx';
    function Fixture() {
      const state = useLocale(), [draft, setDraft] = useState('');
      return <><output id="state">{JSON.stringify(state)}</output>
        <select aria-label="Language" value={state.preference} onChange={e => state.setPreference(e.target.value)}>
          <option value="platform">Follow 4yi</option><option value="zh-CN">中文</option><option value="en">English</option>
        </select><input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)}/></>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `},
  bundle: true, write: false, format: 'iife', platform: 'browser', define: {'process.env.NODE_ENV': '"test"'},
});
const origin = 'https://locale-state.fixture.invalid';
const browser = await chromium.launch({channel: 'chrome', headless: true});
const errors = [], checks = [];
try {
  const context = await browser.newContext({locale: 'en-US'});
  let response = {locale: 'zh-CN', scopeFingerprint: 'alice'};
  let hold = false, release, requested;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, 'only deterministic fixture traffic');
    if (url.pathname === '/api/locale') {
      requested?.();
      if (hold) await new Promise(resolve => {release = resolve;});
      return route.fulfill({json: response}).catch(() => {});
    }
    if (url.pathname === '/app.js') return route.fulfill({contentType: 'text/javascript', body: bundle.outputFiles[0].text});
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>'});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.locator('#state').textContent().then(JSON.parse);
  const expect = async (locale, preference, platformAvailable) => {
    await page.waitForFunction(expected => {
      const state = JSON.parse(document.querySelector('#state')?.textContent || '{}');
      return state.locale === expected.locale && state.preference === expected.preference && state.platformAvailable === expected.platformAvailable;
    }, {locale, preference, platformAvailable});
    assert.deepEqual(await state(), {locale, preference, platformAvailable});
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
  };
  const refresh = async value => {response = value; await page.evaluate(() => window.dispatchEvent(new Event('focus')));};
  await page.goto(origin); await expect('zh-CN', 'platform', true);
  await page.getByLabel('Draft').fill('keep this unsent description');
  await page.getByLabel('Language').selectOption('en'); await expect('en', 'en', true);
  await refresh({locale: 'en', scopeFingerprint: 'alice'}); await expect('en', 'platform', true);
  await refresh({locale: 'zh-CN', scopeFingerprint: 'alice'}); await expect('zh-CN', 'platform', true);
  assert.equal(await page.getByLabel('Draft').inputValue(), 'keep this unsent description');
  checks.push('platform round trip permanently retires stale manual override without resetting draft');

  await refresh({locale: null, scopeFingerprint: 'alice'}); await expect('zh-CN', 'platform', false);
  await page.reload(); await expect('zh-CN', 'platform', false);
  checks.push('temporary missing locale preserves last known language for the same scope, including reload');

  await refresh({locale: 'en', scopeFingerprint: 'alice'}); await expect('en', 'platform', true);
  await page.getByLabel('Language').selectOption('zh-CN'); await expect('zh-CN', 'zh-CN', true);
  await refresh({locale: 'en', scopeFingerprint: 'bob'}); await expect('en', 'platform', true);
  await refresh({locale: 'zh-CN', scopeFingerprint: null}); await expect('en', 'platform', false);
  await refresh({locale: 'en', scopeFingerprint: 'alice'}); await expect('zh-CN', 'zh-CN', true);
  checks.push('account changes load only their scoped preference; missing scope drops previous account language');

  hold = true; response = {locale: 'en', scopeFingerprint: 'new-user'};
  const began = new Promise(resolve => {requested = resolve;});
  await page.reload(); await began;
  await page.getByLabel('Language').selectOption('zh-CN'); await expect('zh-CN', 'zh-CN', false);
  hold = false; release(); requested = null;
  await expect('zh-CN', 'zh-CN', true);
  await refresh({locale: 'zh-CN', scopeFingerprint: 'new-user'}); await expect('zh-CN', 'platform', true);
  await refresh({locale: 'en', scopeFingerprint: 'new-user'}); await expect('en', 'platform', true);
  checks.push('manual choice before initial scope response binds once, then later platform changes take over');

  await page.clock.install();
  hold = true; const stalled = new Promise(resolve => {requested = resolve;});
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await stalled;
  await page.clock.fastForward(15_100);
  await expect('en', 'platform', true);
  hold = false; release(); requested = null;
  await refresh({locale: 'zh-CN', scopeFingerprint: 'new-user'}); await expect('zh-CN', 'platform', true);
  checks.push('request timeout releases pending guard and the next refresh can recover');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({kind: 'fixture-browser-regression', checks, pageErrors: errors}, null, 2));
} finally {await browser.close();}
