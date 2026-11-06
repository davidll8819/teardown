import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from './server.mjs';
import {platformLocaleFromCookie, resolveLocalePreference} from './platform-locale.mjs';

test('4yi locale cookies are bounded presentation values, with secure-cookie precedence', () => {
  assert.equal(platformLocaleFromCookie('__Host-xclaw_app_locale=en; unrelated=ignored'), 'en');
  assert.equal(platformLocaleFromCookie('xclaw_app_locale=zh'), 'zh-CN');
  assert.equal(platformLocaleFromCookie('__Host-xclaw_app_locale=zh; xclaw_app_locale=en'), 'zh-CN');
  for (const value of [undefined, '', '__Host-xclaw_app_locale=other', '__Host-xclaw_app_locale=en%3B', '__Host-xclaw_app_locale=bad; xclaw_app_locale=en']) assert.equal(platformLocaleFromCookie(value), null);
});
test('new platform language supersedes a stale manual preference, otherwise explicit choice is kept', () => {
  const manual = {preference:'zh-CN', platformLocaleAtChoice:'zh-CN'};
  assert.deepEqual(resolveLocalePreference(manual, 'en', 'zh-CN'), {preference:'platform', locale:'en'});
  assert.deepEqual(resolveLocalePreference(manual, 'zh-CN', 'en'), {preference:'zh-CN', locale:'zh-CN'});
  assert.deepEqual(resolveLocalePreference(null, 'en', 'zh-CN'), {preference:'platform', locale:'en'});
  assert.deepEqual(resolveLocalePreference(null, null, 'en'), {preference:'platform', locale:'en'});
});
test('locale endpoint requires existing identity verification and returns only safe scoped presentation data', async () => {
  const server = createApp({store:{}, verifyIdentity:req => req.headers['test-identity'] === 'valid', runtimeInfo:scope => ({scopeFingerprint:scope.user === 'alice' ? 'scope-alice' : 'scope-bob', privateField:'must-not-leak'})});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/api/locale',{headers:{cookie:'__Host-xclaw_app_locale=en'}})).status,401);
    for (const user of ['alice','bob']) {
      const response = await fetch(base+'/api/locale',{headers:{'test-identity':'valid','x-xclaw-owner-org-id':'org','x-xclaw-user-id':user,cookie:'__Host-xclaw_app_locale=en'}});
      assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
      assert.deepEqual(await response.json(),{locale:'en',scopeFingerprint:`scope-${user}`});
    }
  } finally { server.close(); await once(server,'close'); }
});
