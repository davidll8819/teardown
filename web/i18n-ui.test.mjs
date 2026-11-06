import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranslator, formatDuration, formatStamp, knownMessage} from './i18n-ui.js';
import {previewMessage} from './preview-loader.mjs';
import {createJobWithReferences} from './reference-images.js';

test('language changes translate an existing error without changing its stored source or interpolated user content', () => {
  const error = {code: 'preview_auth'};
  assert.match(previewMessage(error, 'en'), /session has expired/);
  assert.match(previewMessage(error, 'zh-CN'), /登录状态已失效/);
  assert.deepEqual(error, {code: 'preview_auth'});
  const name = '用户原图 {name}.jpg';
  assert.equal(createTranslator('en')('放大参考图 {name}', {name}), `Enlarge reference image ${name}`);
  assert.equal(createTranslator('zh-CN')('放大参考图 {name}', {name}), `放大参考图 ${name}`);
  assert.equal(knownMessage('untrusted upstream detail', '图片处理失败，请重新选择。'), '图片处理失败，请重新选择。');
});

test('every preview failure and its safe unknown fallback have Chinese and English messages', () => {
  for (const code of ['preview_auth','preview_forbidden','preview_missing','preview_pending','preview_unavailable','preview_redirect','preview_timeout','preview_too_large','preview_invalid','preview_network','unknown_sensitive_detail']) {
    const error={code};
    assert.match(previewMessage(error,'zh-CN'), /\p{Script=Han}/u);
    assert.doesNotMatch(previewMessage(error,'en'), /\p{Script=Han}/u);
    assert.ok(!previewMessage(error,'en').includes(code));
  }
});

test('dates and durations use the selected language rather than the previous Chinese locale', () => {
  const job = {createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:01:23Z'};
  assert.equal(formatDuration(job, 'en'), '1 min 23 s');
  assert.equal(formatDuration(job, 'zh-CN'), '1 分 23 秒');
  assert.equal(formatStamp(job.createdAt, 'en'), new Date(job.createdAt).toLocaleString('en', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}));
});

test('selected task language survives both ordinary submission and a definite 413 upload fallback', async () => {
  const image = {name: 'original.png', mimeType: 'image/png', data: 'YWJj'};
  const id = '12345678-1234-4234-9234-123456789012';
  for (const fallback of [false, true]) {
    const jobs = []; let offset = 0;
    const request = async (url, options) => {
      const value = options.body ? JSON.parse(options.body) : {};
      if (url === '/api/jobs') {
        jobs.push(value);
        if (fallback && jobs.length === 1) throw Object.assign(new Error('body_too_large'), {status:413});
        return {id:'job',locale:value.locale};
      }
      if (url === '/api/reference-uploads') return {id,chunkCharacters:8192};
      if (url.endsWith('/chunks')) {offset+=value.data.length;return {offset};}
      if (url.endsWith('/complete')) return {id,completed:true};
      return {};
    };
    const result = await createJobWithReferences('Keep my original description', [image], {request,locale:'en'});
    assert.equal(result.locale,'en');
    assert.equal(jobs.length, fallback ? 2 : 1);
    assert.ok(jobs.every(job => job.locale === 'en' && job.description === 'Keep my original description'));
    assert.equal(jobs.at(-1).referenceUploadId, fallback ? id : undefined);
  }
});
