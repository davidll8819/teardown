import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from './server.mjs';
import {createJobStore} from './jobs.mjs';
import {createRouterIdentityVerifier} from './router-identity.mjs';
import {createHash, createHmac} from 'node:crypto';
import {imageFixture, pngFixture} from './reference-fixtures.mjs';
import {MAX_JOB_BODY_BYTES} from './references.mjs';
import http from 'node:http';

test('malformed unauthenticated request targets do not crash the service', async () => {
  const server = createApp({store: {}});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.get({host: '127.0.0.1', port: server.address().port, path: '//['}, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
    assert.equal(status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/healthz`)).status, 200);
  } finally {server.close(); await once(server, 'close');}
});

test('non-local HTTP requests require a valid, non-replayed router signature', async () => {
  const key = 'a'.repeat(64); const host = 'app.example';
  const verifyIdentity = createRouterIdentityVerifier({key, hostname: host});
  const server = createApp({store: {list: async () => []}, verifyIdentity});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const time = String(Date.now()); const nonce = 'b'.repeat(32);
  const headers = {'x-xclaw-user-id':'alice','x-xclaw-owner-org-id':'org','x-xclaw-hostname':host,'x-xclaw-identity-time':time,'x-xclaw-identity-nonce':nonce};
  const hash = createHash('sha256').update('').digest('hex');
  headers['x-xclaw-identity-signature'] = createHmac('sha256',key).update(JSON.stringify(['v1',host,'GET','/api/jobs','alice','org',time,nonce,hash])).digest('hex');
  try {
    assert.equal((await fetch(`${base}/api/jobs`, {headers:{...headers, 'x-xclaw-user-id':'mallory'}})).status, 401);
    assert.equal((await fetch(`${base}/api/jobs`, {headers})).status, 200);
    assert.equal((await fetch(`${base}/api/jobs`, {headers})).status, 401);
  } finally { server.close(); await once(server, 'close'); }
});

test('HTTP jobs require identity and same origin, and preview enforces sandbox CSP', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-http-'));
  const store = createJobStore({directory, generate: async () => ({html: '<script>1</script>'})});
  const server = createApp({store, verifyIdentity: () => true}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = {'x-xclaw-owner-org-id': 'org', 'x-xclaw-user-id': 'alice', 'x-xclaw-hostname': 'app.example'};
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/api/jobs`)).status, 401);
    const init = {method: 'POST', headers: {...auth, origin: 'https://other.example', 'content-type': 'application/json'}, body: JSON.stringify({description: 'A rotating crank'})};
    assert.equal((await fetch(`${base}/api/jobs`, init)).status, 403);
    init.headers.origin = 'https://app.example';
    const response = await fetch(`${base}/api/jobs`, init); assert.equal(response.status, 202);
    const job = await response.json();
    assert.equal((await fetch(`${base}/api/jobs/${job.id}`, {headers: {...auth, 'x-xclaw-user-id': 'bob'}})).status, 404);
    let preview;
    for (let i = 0; i < 100; i++) { preview = await fetch(`${base}/api/jobs/${job.id}/preview`, {headers: auth}); if (preview.status === 200) break; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.match(preview.headers.get('content-security-policy'), /connect-src 'none'/);
  } finally { server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true}); }
});

test('signed reference uploads cover the complete body and downloads preserve scope', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-upload-http-'));
  const key = 'a'.repeat(64); const hostname = 'app.example';
  const reference = imageFixture({padding: 20000});
  const store = createJobStore({directory, generate: async ({references, onAnalysis}) => {
    assert.deepEqual(references, [reference]);
    onAnalysis({summary: 'An orange reference.', observedParts: ['orange'], inferredParts: [], uncertainties: ['Not a photograph of a real mechanism.']});
    return {html: '<p>result</p>'};
  }});
  const server = createApp({store, verifyIdentity: createRouterIdentityVerifier({key, hostname})});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let count = 0;
  const signed = (method, url, body = '', user = 'alice', org = 'org') => {
    const time = String(Date.now()); const nonce = (++count).toString(16).padStart(32, '0');
    const headers = {'x-xclaw-user-id': user, 'x-xclaw-owner-org-id': org, 'x-xclaw-hostname': hostname, 'x-xclaw-identity-time': time, 'x-xclaw-identity-nonce': nonce, origin: `https://${hostname}`, 'content-type': 'application/json'};
    const hash = createHash('sha256').update(body).digest('hex');
    headers['x-xclaw-identity-signature'] = createHmac('sha256', key).update(JSON.stringify(['v1', hostname, method, url, user, org, time, nonce, hash])).digest('hex');
    return headers;
  };
  try {
    const body = JSON.stringify({description: '分析参考图中的机械', references: [reference]});
    assert.ok(body.length > 16384);
    const tampered = await fetch(`${base}/api/jobs`, {method: 'POST', headers: signed('POST', '/api/jobs', body), body: body.replace('分析参考图中的机械', '分析参考图中的马达')});
    assert.equal(tampered.status, 401);
    const response = await fetch(`${base}/api/jobs`, {method: 'POST', headers: signed('POST', '/api/jobs', body), body});
    assert.equal(response.status, 202);
    const job = await response.json();
    const url = `/api/jobs/${job.id}/references/${job.references[0].id}`;
    const image = await fetch(`${base}${url}`, {headers: signed('GET', url)});
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('cache-control'), 'no-store'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), pngFixture({padding: 20000}));
    assert.equal((await fetch(`${base}${url}`, {headers: signed('GET', url, '', 'bob')})).status, 404);
    assert.equal((await fetch(`${base}${url}`, {headers: signed('GET', url, '', 'alice', 'other')})).status, 404);
    const invalid = JSON.stringify({description: '图片', references: [{...reference, mimeType: 'image/svg+xml'}]});
    // Wait for the real generation lease to finish before testing validation.
    for (let i = 0; i < 100 && (await store.get({org: 'org', user: 'alice'}, job.id)).status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const rejected = await fetch(`${base}/api/jobs`, {method: 'POST', headers: signed('POST', '/api/jobs', invalid), body: invalid});
    assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error, 'reference_type_invalid');
    const cancel = `/api/jobs/${job.id}/cancel`;
    const large = JSON.stringify({padding: 'x'.repeat(17000)});
    assert.equal((await fetch(`${base}${cancel}`, {method: 'POST', headers: signed('POST', cancel, large), body: large})).status, 413);
  } finally {server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true});}
});

test('local upload body limit returns a usable 413 response', async () => {
  const server = createApp({store: {create: async () => {throw new Error('must_not_create');}}, local: true});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/jobs`, {method: 'POST', headers: {origin: base, 'content-type': 'application/json'}, body: JSON.stringify({padding: 'x'.repeat(MAX_JOB_BODY_BYTES)})});
    assert.equal(response.status, 413); assert.deepEqual(await response.json(), {error: 'body_too_large'});
  } finally {server.close(); await once(server, 'close');}
});
