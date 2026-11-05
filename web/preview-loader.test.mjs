import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPreviewDocument, readPreview, previewMessage, PREVIEW_CSP} from './preview-loader.mjs';

const html = '<!doctype html><html lang="zh-CN"><head><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"><title>Simulator</title></head><body><main id="app"></main><script>document.getElementById("app").textContent="ready"</script></body></html>';
const reply = (body = html, options = {}) => new Response(body, {headers: {'content-type': 'text/html; charset=utf-8'}, ...options});
const fails = code => error => error.code === code;

test('preview fetch uses the current origin credentials and never follows login redirects', async () => {
  let captured;
  const loaded = await readPreview('/api/jobs/a/preview', {fetchImpl: async (url, options) => {captured = {url, options}; return reply();}});
  assert.equal(loaded, html);
  assert.equal(captured.url, '/api/jobs/a/preview');
  assert.equal(captured.options.credentials, 'same-origin');
  assert.equal(captured.options.redirect, 'manual');
  assert.equal(captured.options.cache, 'no-store');
  const document = isolatedPreviewDocument(loaded);
  assert.ok(document.indexOf(PREVIEW_CSP) < document.indexOf("connect-src 'none'\"><title>"));
  assert.equal((document.match(/http-equiv="Content-Security-Policy"/g) || []).length, 2);
  assert.ok(document.includes('<main id="app">'));
});

test('preview authorization and missing results remain distinguishable without claiming deletion', async () => {
  for (const [status, code] of [[401, 'preview_auth'], [403, 'preview_forbidden'], [404, 'preview_missing'], [409, 'preview_pending'], [503, 'preview_unavailable']]) {
    await assert.rejects(readPreview('/preview', {fetchImpl: async () => reply('not available', {status})}), fails(code));
  }
  assert.match(previewMessage({code: 'preview_auth'}), /登录状态/);
  assert.match(previewMessage({code: 'preview_missing'}), /当前账号或应用实例/);
  assert.doesNotMatch(previewMessage({code: 'preview_missing'}), /删除/);
});

test('redirects, login HTML, non-HTML and invalid UTF-8 cannot become blank iframes or downloads', async () => {
  for (const response of [reply('', {status: 302}), {type: 'opaqueredirect'}, {redirected: true}]) {
    await assert.rejects(readPreview('/preview', {fetchImpl: async () => response}), fails('preview_redirect'));
  }
  for (const response of [reply('<!doctype html><html><head><title>Login</title></head><body>Sign in</body></html>'), reply('{}', {headers: {'content-type': 'application/json'}}), reply(Uint8Array.from([0xc3, 0x28]))]) {
    await assert.rejects(readPreview('/preview', {fetchImpl: async () => response}), fails('preview_invalid'));
  }
});

test('both declared and streamed preview bodies obey the size limit', async () => {
  let cancelled = 0;
  const stream = () => new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(50));}, cancel() {cancelled++;}});
  await assert.rejects(readPreview('/preview', {maxBytes: 20, fetchImpl: async () => new Response(stream(), {headers: {'content-type': 'text/html', 'content-length': '999'}})}), fails('preview_too_large'));
  await assert.rejects(readPreview('/preview', {maxBytes: 20, fetchImpl: async () => new Response(stream(), {headers: {'content-type': 'text/html'}})}), fails('preview_too_large'));
  assert.equal(cancelled, 2);
});

test('one timeout covers both fetching headers and a stalled body', async () => {
  await assert.rejects(readPreview('/preview', {timeoutMs: 15, fetchImpl: () => new Promise(() => {})}), fails('preview_timeout'));
  let cancelled = false;
  await assert.rejects(readPreview('/preview', {timeoutMs: 15, fetchImpl: async () => reply(new ReadableStream({cancel() {cancelled = true;}}))}), fails('preview_timeout'));
  assert.equal(cancelled, true);
});

test('switching away aborts a pending preview, including its body stream', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const load = readPreview('/preview', {signal: controller.signal, fetchImpl: async () => reply(new ReadableStream({cancel() {cancelled = true;}}))});
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(load, fails('preview_cancelled'));
  assert.equal(cancelled, true);
  await assert.rejects(readPreview('/preview', {signal: controller.signal, fetchImpl: () => {throw new Error('must not start');}}), fails('preview_cancelled'));
});
