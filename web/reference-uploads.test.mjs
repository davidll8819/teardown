import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReferenceUploadStore, UPLOAD_CHUNK_CHARACTERS, UPLOAD_BODY_BYTES} from './reference-uploads.mjs';
import {createJobWithReferences} from './reference-images.js';
import {createApp} from './server.mjs';
import {createJobStore} from './jobs.mjs';
import {createRouterIdentityVerifier} from './router-identity.mjs';
import {imageFixture} from './reference-fixtures.mjs';

const alice = {org: 'a', user: 'alice'}, bob = {org: 'a', user: 'bob'}, otherOrg = {org: 'b', user: 'alice'};
const metadata = image => ({name: image.name, mimeType: image.mimeType, bytes: Buffer.from(image.data, 'base64').length});
function fill(store, id, image, reference = 0, scope = alice) {
  for (let offset = 0; offset < image.data.length; offset += UPLOAD_CHUNK_CHARACTERS) store.append(scope, id, {reference, offset, data: image.data.slice(offset, offset + UPLOAD_CHUNK_CHARACTERS)});
}

test('bounded upload batch preserves exact images, validates completion and consumes once', async t => {
  const store = createReferenceUploadStore(); t.after(() => store.dispose());
  const images = [imageFixture({padding: 120000}), imageFixture()];
  const {id} = store.begin(alice, images.map(metadata));
  assert.throws(() => store.complete(alice, id), /reference_upload_incomplete/);
  images.forEach((image, index) => fill(store, id, image, index));
  assert.deepEqual(store.complete(alice, id), {id, completed: true});
  assert.deepEqual(store.complete(alice, id), {id, completed: true});
  const result = await store.use(alice, id, async actual => {assert.deepEqual(actual, images); return {id: 'a job'};});
  assert.deepEqual(result, {id: 'a job'});
  await assert.rejects(store.use(alice, id, () => assert.fail()), /reference_upload_not_found/);
});

test('upload IDs never bypass scope; chunks reject gaps, changed retries and malformed data', t => {
  const store = createReferenceUploadStore(); t.after(() => store.dispose());
  const image = imageFixture({padding: 20000});
  const {id} = store.begin(alice, [metadata(image)]);
  for (const scope of [bob, otherOrg]) {
    assert.throws(() => store.append(scope, id, {reference: 0, offset: 0, data: image.data.slice(0, 8192)}), /reference_upload_not_found/);
    assert.throws(() => store.complete(scope, id), /reference_upload_not_found/);
    assert.throws(() => store.cancel(scope, id), /reference_upload_not_found/);
  }
  assert.throws(() => store.append(alice, id, {reference: 0, offset: 8192, data: image.data.slice(8192, 16384)}), /reference_upload_conflict/);
  const first = {reference: 0, offset: 0, data: image.data.slice(0, 8192)};
  assert.equal(store.append(alice, id, first).offset, 8192);
  assert.equal(store.append(alice, id, first).offset, 8192);
  const changed = Buffer.from(first.data, 'base64'); changed[10] ^= 1;
  assert.throws(() => store.append(alice, id, {...first, data: changed.toString('base64')}), /reference_upload_conflict/);
  assert.throws(() => store.append(alice, id, {...first, offset: -1}), /reference_upload_invalid/);
  assert.throws(() => store.append(alice, id, {...first, data: '!!!!'}), /reference_upload_invalid/);
  assert.throws(() => store.append(alice, id, {...first, reference: 9}), /reference_upload_invalid/);
  assert.throws(() => store.complete(alice, id), /reference_upload_incomplete/);
  assert.deepEqual(store.cancel(alice, id), {cancelled: true});
});

test('metadata, format, aggregate quota, expiry, creation rate and concurrent consumption are bounded', async t => {
  let clock = 100;
  const image = imageFixture(), info = metadata(image);
  const store = createReferenceUploadStore({now: () => clock, ttlMs: 1000, maxBatches: 2, maxBytes: info.bytes * 2}); t.after(() => store.dispose());
  assert.throws(() => store.begin(alice, []), /references_invalid/);
  assert.throws(() => store.begin(alice, [info, info, info, info]), /references_invalid/);
  assert.throws(() => store.begin(alice, [{...info, bytes: 2097153}]), /reference_too_large/);
  assert.throws(() => store.begin(alice, Array(3).fill({...info, bytes: 2097152})), /references_too_large/);
  assert.throws(() => store.begin(alice, [{...info, mimeType: 'image/svg+xml'}]), /reference_type_invalid/);
  const first = store.begin(alice, [info]);
  assert.throws(() => store.begin(alice, [info]), /reference_upload_capacity/);
  const second = store.begin(bob, [info]);
  assert.throws(() => store.begin(otherOrg, [info]), /reference_upload_capacity/);
  clock += 1001;
  assert.throws(() => store.complete(alice, first.id), /reference_upload_not_found/);
  const valid = store.begin(alice, [info]); fill(store, valid.id, image); store.complete(alice, valid.id);
  let release;
  const held = store.use(alice, valid.id, () => new Promise(resolve => {release = resolve;}));
  await assert.rejects(store.use(alice, valid.id, () => assert.fail()), /reference_upload_in_use/);
  assert.throws(() => store.cancel(alice, valid.id), /reference_upload_in_use/);
  release('done'); await held;
  for (let i = 0; i < 2; i++) {const batch = store.begin(alice, [info]); store.cancel(alice, batch.id);}
  assert.throws(() => store.begin(alice, [info]), /reference_upload_rate_limited/);
  clock += 600001;
  const corrupt = store.begin(alice, [info]);
  const invalidImage = {...image, data: Buffer.alloc(info.bytes).toString('base64')}; fill(store, corrupt.id, invalidImage);
  assert.throws(() => store.complete(alice, corrupt.id), /reference_image_invalid/);
  assert.throws(() => store.complete(alice, corrupt.id), /reference_upload_not_found/);
  assert.throws(() => store.cancel(bob, second.id), /reference_upload_not_found/);
});

test('real signed HTTP fallback succeeds behind a synthetic 16 KiB ingress without duplicate jobs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reference-upload-http-'));
  const image = imageFixture({padding: 120000}); let generated = 0;
  const store = createJobStore({directory, generate: async ({references}) => {generated++; assert.deepEqual(references, [image]); return {html: '<p>uploaded</p>'};}});
  const key = randomBytes(32).toString('hex'), hostname = 'upload.fixture';
  const server = createApp({store, verifyIdentity: createRouterIdentityVerifier({key, hostname})});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const signed = (method, url, body = '', scope = alice) => {
    const time = String(Date.now()), nonce = randomBytes(16).toString('hex');
    return {'x-xclaw-user-id': scope.user, 'x-xclaw-owner-org-id': scope.org, 'x-xclaw-hostname': hostname, 'x-xclaw-identity-time': time, 'x-xclaw-identity-nonce': nonce, 'x-xclaw-identity-signature': createHmac('sha256', key).update(JSON.stringify(['v1', hostname, method, url, scope.user, scope.org, time, nonce, createHash('sha256').update(body).digest('hex')])).digest('hex'), origin: `https://${hostname}`, 'content-type': 'application/json'};
  };
  const requests = [];
  const request = async (url, options = {}) => {
    const body = options.body || '', method = options.method || 'GET';
    requests.push({url, method, bytes: Buffer.byteLength(body)});
    if (Buffer.byteLength(body) > 16384) throw Object.assign(new Error('body_too_large'), {status: 413});
    const response = await fetch(base + url, {...options, headers: signed(method, url, body)});
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), {status: response.status});
    return result;
  };
  try {
    const job = await createJobWithReferences('使用参考图建立机械模型', [image], {request});
    assert.equal(job.references.length, 1);
    assert.equal(requests.filter(r => r.url === '/api/jobs' && r.method === 'POST').length, 2);
    assert.ok(requests[0].bytes > 16384);
    assert.ok(requests.slice(1).every(r => r.bytes <= UPLOAD_BODY_BYTES));
    assert.ok(requests.some(r => r.url.endsWith('/complete')));
    for (let i = 0; i < 50 && (await store.get(alice, job.id)).status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await store.get(alice, job.id)).status, 'completed'); assert.equal(generated, 1);
    const bytes = await store.reference(alice, job.id, job.references[0].id);
    assert.deepEqual(bytes.buffer, Buffer.from(image.data, 'base64'));
    const init = JSON.stringify({references: [metadata(image)]});
    const createResponse = await fetch(base + '/api/reference-uploads', {method: 'POST', headers: signed('POST', '/api/reference-uploads', init), body: init});
    const upload = await createResponse.json();
    const url = `/api/reference-uploads/${upload.id}/chunks`, body = JSON.stringify({reference: 0, offset: 0, data: image.data.slice(0, 8192)});
    assert.equal((await fetch(base + url, {method: 'POST', headers: signed('POST', url, body, bob), body})).status, 404);
    assert.equal((await fetch(base + url, {method: 'POST', headers: signed('POST', url, body, otherOrg), body})).status, 404);
    assert.equal((await fetch(base + url, {method: 'POST', headers: signed('POST', url, body), body: body.replace('0,', '1,')})).status, 401);
    assert.equal((await fetch(base + url, {method: 'POST', headers: {...signed('POST', url, body), origin: 'https://evil.fixture'}, body})).status, 403);
    const oversized = JSON.stringify({data: 'x'.repeat(UPLOAD_BODY_BYTES)});
    assert.equal((await fetch(base + url, {method: 'POST', headers: signed('POST', url, oversized), body: oversized})).status, 413);
    assert.equal((await fetch(base + url, {method: 'POST', headers: {'content-type': 'application/json'}, body})).status, 401);
  } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true});}
});

test('browser never retries ambiguous submission or non-413 failures', async () => {
  for (const error of [Object.assign(new Error('timeout'), {uncertain: true}), Object.assign(new Error('too large?'), {status: 413, uncertain: true}), Object.assign(new Error('server failed'), {status: 500}), Object.assign(new Error('invalid'), {status: 400})]) {
    let calls = 0;
    await assert.rejects(createJobWithReferences('test', [imageFixture()], {request: async () => {calls++; throw error;}}), error);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(createJobWithReferences('test', [], {request: async () => {calls++; throw Object.assign(new Error('body_too_large'), {status: 413});}}), /body_too_large/);
  assert.equal(calls, 1);
});

test('browser cleans failed batches and distinguishes temporary upload uncertainty from job uncertainty', async () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  for (const finalStage of [false, true]) {
    const calls = [];
    const request = async (url, options) => {
      calls.push({url, method: options.method});
      if (url === '/api/jobs' && calls.length === 1) throw Object.assign(new Error('body_too_large'), {status: 413});
      if (url === '/api/reference-uploads') return {id, chunkCharacters: 8192};
      if (url.endsWith('/chunks')) {
        if (!finalStage) throw Object.assign(new Error('request_timeout'), {code: 'request_timeout', uncertain: true});
        const part = JSON.parse(options.body); return {offset: part.offset + part.data.length};
      }
      if (url.endsWith('/complete')) return {id, completed: true};
      if (url === '/api/jobs') throw Object.assign(new Error('request_timeout'), {code: 'request_timeout', uncertain: true});
      if (options.method === 'DELETE') return {cancelled: true};
      assert.fail('Unexpected request');
    };
    await assert.rejects(createJobWithReferences('test', [imageFixture()], {request}), error => error.code === 'request_timeout' && error.uncertain === finalStage);
    assert.equal(calls.filter(call => call.url === '/api/jobs').length, finalStage ? 2 : 1);
    assert.equal(calls.at(-1).method, 'DELETE');
  }
});

test('failed job creation releases completed upload reservation', async t => {
  const store = createReferenceUploadStore(); t.after(() => store.dispose());
  const image = imageFixture(), first = store.begin(alice, [metadata(image)]);
  fill(store, first.id, image); store.complete(alice, first.id);
  await assert.rejects(store.use(alice, first.id, () => {throw new Error('job_capacity_reached');}), /job_capacity_reached/);
  assert.throws(() => store.complete(alice, first.id), /reference_upload_not_found/);
  assert.ok(store.begin(alice, [metadata(image)]).id);
});

test('excessive duplicate chunk attempts retire the batch without growing memory', t => {
  const store = createReferenceUploadStore(); t.after(() => store.dispose());
  const image = imageFixture(), {id} = store.begin(alice, [metadata(image)]);
  const chunk = {reference: 0, offset: 0, data: image.data};
  for (let i = 0; i < 12; i++) store.append(alice, id, chunk);
  assert.throws(() => store.append(alice, id, chunk), /reference_upload_rate_limited/);
  assert.throws(() => store.complete(alice, id), /reference_upload_not_found/);
});
