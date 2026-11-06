import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createJobStore} from './jobs.mjs';
import {createApp} from './server.mjs';
import {createReferenceUploadStore} from './reference-uploads.mjs';
import {imageFixture} from './reference-fixtures.mjs';

async function completed(store, scope, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await store.get(scope, id);
    if (job.status === 'completed') return job;
    assert.notEqual(job.status, 'failed');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('job did not complete');
}

test('task locale is immutable, per-job, and survives reopening without rewriting legacy artifacts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-job-locale-'));
  try {
    const received = [];
    const store = createJobStore({directory, generate: async ({locale, description, onProgress}) => {
      received.push({locale, description}); onProgress('working');
      return {html: `<p>${locale}</p>`};
    }});
    const scope = {org: 'org', user: 'alice'};
    const english = await store.create(scope, '中文描述也可以明确选择英文', [], 'en');
    assert.equal(english.locale, 'en');
    const finished = await completed(store, scope, english.id);
    assert.equal(finished.locale, 'en');
    const legacy = await store.create(scope, 'Show a motor');
    assert.equal((await completed(store, scope, legacy.id)).locale, 'zh-CN');
    assert.deepEqual(received.map(job => job.locale), ['en', 'zh-CN']);
    assert.equal(received[0].description, '中文描述也可以明确选择英文');

    const [scopeDirectory] = await readdir(directory);
    const oldMetadata = path.join(directory, scopeDirectory, legacy.id, 'job.json');
    const oldJob = JSON.parse(await readFile(oldMetadata, 'utf8'));
    delete oldJob.locale;
    const original = JSON.stringify(oldJob);
    await writeFile(oldMetadata, original);
    const reopened = createJobStore({directory, generate: () => assert.fail('read must not generate')});
    assert.equal((await reopened.get(scope, english.id)).locale, 'en');
    assert.equal((await reopened.get(scope, legacy.id)).locale, 'zh-CN');
    assert.equal((await reopened.list(scope)).find(job => job.id === english.id).locale, 'en');
    assert.equal(await readFile(oldMetadata, 'utf8'), original);
    assert.equal(await reopened.artifact(scope, legacy.id), '<p>zh-CN</p>');
    await assert.rejects(reopened.get({org: 'org', user: 'bob'}, english.id), /job_not_found/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('unsupported task locales fail before creating metadata or acquiring a generation lease', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-invalid-locale-'));
  try {
    const scope = {org: 'org', user: 'alice'};
    const store = createJobStore({directory, generate: async () => ({html: '<p>ok</p>'})});
    for (const locale of ['zh', 'en-US', 'EN', '', null, 1, [], {}, 'en\n']) {
      await assert.rejects(store.create(scope, 'A motor', [], locale), /invalid_locale/);
      assert.deepEqual(await store.list(scope), []);
    }
    assert.deepEqual(await readdir(directory), []);
    const valid = await store.create(scope, 'A motor', [], 'en');
    assert.equal((await completed(store, scope, valid.id)).locale, 'en');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('HTTP direct and completed-upload submissions preserve locale and reject invalid values before consuming uploads', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-http-locale-'));
  const received = [];
  const store = createJobStore({directory, generate: async ({locale, references}) => {
    received.push({locale, references}); return {html: '<p>ok</p>'};
  }});
  const uploads = createReferenceUploadStore();
  const server = createApp({store, uploads, local: true});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const scope = {org: 'local', user: 'local'};
  const post = body => fetch(`${base}/api/jobs`, {method: 'POST', headers: {origin: base, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  try {
    for (const locale of ['zh', 'fr', null, [], {}]) {
      const response = await post({description: 'Motor', locale});
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {error: 'invalid_locale'});
    }
    assert.deepEqual(await store.list(scope), []);
    const direct = await post({description: 'Motor', locale: 'en'});
    assert.equal(direct.status, 202);
    const directJob = await direct.json();
    assert.equal(directJob.locale, 'en');
    await completed(store, scope, directJob.id);

    const image = imageFixture();
    const upload = uploads.begin(scope, [{name: image.name, mimeType: image.mimeType, bytes: Buffer.from(image.data, 'base64').length}]);
    uploads.append(scope, upload.id, {reference: 0, offset: 0, data: image.data});
    uploads.complete(scope, upload.id);
    const invalidUpload = await post({description: 'Motor photo', referenceUploadId: upload.id, locale: 'en-US'});
    assert.equal(invalidUpload.status, 400);
    assert.deepEqual(await invalidUpload.json(), {error: 'invalid_locale'});
    const uploaded = await post({description: 'Motor photo', referenceUploadId: upload.id, locale: 'en'});
    assert.equal(uploaded.status, 202);
    const uploadedJob = await uploaded.json();
    assert.equal(uploadedJob.locale, 'en');
    await completed(store, scope, uploadedJob.id);
    const defaults = await post({description: 'Default language'});
    assert.equal(defaults.status, 202);
    const defaultJob = await defaults.json();
    assert.equal(defaultJob.locale, 'zh-CN');
    await completed(store, scope, defaultJob.id);
    assert.deepEqual(received.map(job => job.locale), ['en', 'en', 'zh-CN']);
    assert.deepEqual(received[1].references, [image]);
    const read = await fetch(`${base}/api/jobs/${uploadedJob.id}`);
    assert.equal((await read.json()).locale, 'en');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
});
